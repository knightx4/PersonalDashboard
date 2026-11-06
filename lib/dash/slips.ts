/**
 * The times a chat with Dash went wrong in a way it caught itself (plan
 * #2999, migration 0304 core.dash_slips): add_plan_step refused for a thin
 * detail or as a repeat, and a turn that reached its limit. Dev Home counts
 * the last seven days, so the failures that used to end in "text try again"
 * are seen and can be fixed.
 *
 * Pure but for keepSlip and loadSlipCount, which take the client.
 */

import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';

export type DashSlipKind = 'thin_step' | 'repeated_step' | 'out_of_budget';
export type DashSlipSurface = 'ask' | 'people' | 'thread';

/** Where a write or a turn was asked, as a slip names it. */
export type SlipWhere = {
  surface: DashSlipSurface;
  /** 'ask:<id>' or 'people:<chat id>'. */
  conversation: string | null;
  /** The page the conversation opens on. */
  href: string | null;
};

export type DashSlip = SlipWhere & {
  kind: DashSlipKind;
  tool?: string | null;
  /** What was wrong, in a sentence. */
  what: string;
};

/** How far back Dev Home counts. */
export const SLIP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_WHAT = 1000;

/** The row a slip is kept as. */
export function slipRow(userId: string, slip: DashSlip): Record<string, unknown> {
  const what = slip.what.replace(/\s+/g, ' ').trim() || 'No reason was given.';
  return {
    user_id: userId,
    kind: slip.kind,
    surface: slip.surface,
    tool: slip.tool ?? null,
    conversation: slip.conversation,
    href: slip.href && slip.href.startsWith('/') ? slip.href : null,
    what: what.slice(0, MAX_WHAT),
  };
}

type Inserting = { from: (table: string) => { insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> } };

/** Keeps one slip through a core client. Never throws: a slip not kept leaves the reply as it was. */
export async function keepSlip(core: Inserting, userId: string, slip: DashSlip): Promise<void> {
  try {
    const { error } = await core.from('dash_slips').insert(slipRow(userId, slip));
    if (error) console.error('the chat slip was not recorded', error.message);
  } catch (error) {
    console.error('the chat slip was not recorded', error);
  }
}

/** Dev Home's line: how many in the window, and where the newest happened. */
export type SlipCount = { count: number; newestHref: string | null };

/** The slips of the last seven days, counted. Null when they could not be read. */
export async function loadSlipCount(core: CoreSupabaseClient, userId: string, now: number): Promise<SlipCount | null> {
  try {
    const since = new Date(now - SLIP_WINDOW_MS).toISOString();
    const { data, count, error } = await core
      .from('dash_slips')
      .select('href', { count: 'exact' })
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      console.error('the chat slips were not read', error.message);
      return null;
    }
    const newest = (data?.[0] as { href?: string | null } | undefined)?.href ?? null;
    return { count: count ?? data?.length ?? 0, newestHref: newest };
  } catch (error) {
    console.error('the chat slips were not read', error);
    return null;
  }
}

/**
 * The slip a turn that reached a limit is kept as, or null when it did not:
 * given one more stretch and finished in it, or out of room again. `who` is
 * whoever answered, as the line names them.
 */
export function budgetSlip(
  answer: { stop: string; extended?: true },
  who: string,
): Pick<DashSlip, 'kind' | 'what'> | null {
  const limits: Record<string, string> = { lookups: 'its lookups', budget: 'its reading budget', time: 'its time' };
  const ranOut = limits[answer.stop];
  if (!answer.extended && !ranOut) return null;
  return {
    kind: 'out_of_budget',
    what: ranOut
      ? `${who}'s turn ran out of ${ranOut}${answer.extended ? ' after one more stretch' : ''}, and answered with what it had.`
      : `${who}'s turn reached a limit, was given one more stretch and finished in it.`,
  };
}

/** A title's words, lower case and without punctuation, for telling a repeat. */
function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Whether two step titles say the same thing: the same words once case and
 * punctuation are set aside, or four in five of their words shared.
 */
export function sameStepTitle(a: string, b: string): boolean {
  const x = titleWords(a);
  const y = titleWords(b);
  if (x.length === 0 || y.length === 0) return false;
  if (x.join(' ') === y.join(' ')) return true;
  const xs = new Set(x);
  const ys = new Set(y);
  let shared = 0;
  for (const word of xs) if (ys.has(word)) shared += 1;
  const union = xs.size + ys.size - shared;
  return union > 0 && shared / union >= 0.8;
}
