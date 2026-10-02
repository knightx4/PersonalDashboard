import type { SupabaseClient } from '@supabase/supabase-js';
import { MODULE_IDS, type ModuleId } from '@/lib/modules';

/**
 * The weekly vision review's clock (plan #1108): when it is due, what the
 * routine is told, and what the Dash tab says about the last run.
 *
 * A run is two facts in two tables. The fire is a `plan_runs` row with job
 * `vision` and no step, written by the weekly tick. What the run found is the
 * `vision_reviews` rows it wrote, all sharing one `review_id`. The last run
 * is the newer of the two, because the first review was run by hand and has
 * no fire behind it, and a fire that has not written anything yet is still a
 * run.
 *
 * Not `server-only`: the rules are pure and the loader only queries the
 * client it is handed.
 */

/**
 * How recent a run must be to stop another one. Six days rather than seven so
 * the Sunday tick is never refused by last Sunday's run finishing a few
 * minutes later in the day than this week's tick fires.
 */
export const VISION_REVIEW_GAP_MS = 6 * 24 * 60 * 60 * 1000;

/** A week, for when the next run is due. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** The weekly fire, as its `plan_runs` row records it. */
export type VisionFire = {
  status: 'started' | 'finished' | 'failed';
  at: string;
  error: string | null;
};

export type VisionReviewDue = { due: true } | { due: false; reason: string };

/**
 * Whether the tick should fire. Not when a review was written in the last six
 * days, and not when a fire in that time started a run that may still be
 * writing. A fire that failed does not count, so the next call tries again.
 */
export function visionReviewDue(input: {
  lastFire: VisionFire | null;
  lastReviewAt: string | null;
  now: number;
}): VisionReviewDue {
  const recent = (at: string | null) =>
    at !== null && input.now - new Date(at).getTime() < VISION_REVIEW_GAP_MS;
  if (recent(input.lastReviewAt)) {
    return { due: false, reason: `a review was written at ${input.lastReviewAt}` };
  }
  if (input.lastFire && input.lastFire.status !== 'failed' && recent(input.lastFire.at)) {
    return { due: false, reason: `a review was started at ${input.lastFire.at}` };
  }
  return { due: true };
}

/**
 * Page opens per workspace over the review's window (plan #1483), from
 * core.workspace_opens. Recording began with plan #1481, so `recordingSince`
 * is when the first open was recorded, or null when none has been: a zero
 * before that is not disuse, only nothing measured.
 */
export type WindowOpens = {
  /** The window's start: the last review, or null on the first run. */
  since: string | null;
  recordingSince: string | null;
  /** Opens and distinct pages per workspace; `outside` is /home, /ask and the rest. */
  counts: Partial<Record<ModuleId | 'outside', { opens: number; pages: number }>>;
};

const dateOf = (at: string) => at.slice(0, 10);

/** The opens as the routine is told them: one sentence per fact, every workspace named. */
export function opensText(input: WindowOpens | null): string {
  const cite =
    "Cite each workspace's page opens in its note, and read them for a workspace's own window " +
    'with core.workspace_opens as the skill says.';
  if (input === null) {
    return `The page opens could not be read when this run was fired. ${cite}`;
  }
  if (input.recordingSince === null) {
    return (
      'No page opens have been recorded yet, so there is no measure of use for any workspace. ' +
      'Say so in each note rather than reading it as a workspace going unused.'
    );
  }
  const partial =
    input.since === null || Date.parse(input.recordingSince) > Date.parse(input.since);
  const head = partial
    ? `Page opens since recording began on ${dateOf(input.recordingSince)}; ` +
      'use before then was not recorded, so a low count is not yet disuse'
    : `Page opens since the last review on ${dateOf(input.since as string)}`;
  const one = (key: ModuleId | 'outside') => {
    const count = input.counts[key];
    const name = key === 'outside' ? 'pages outside any workspace' : key;
    if (!count || count.opens === 0) return `${name} none`;
    return `${name} ${count.opens} ${count.opens === 1 ? 'open' : 'opens'} across ${count.pages} ${
      count.pages === 1 ? 'page' : 'pages'
    }`;
  };
  const list = [...MODULE_IDS, 'outside' as const].map(one).join(', ');
  return `${head}: ${list}. ${cite}`;
}

/** The turn appended to the routine's session: whose visions, how, and the opens. */
export function visionRunText(userId: string, opens?: WindowOpens | null): string {
  return (
    `Run the weekly vision review for user_id ${userId}. Read ` +
    '.claude/skills/vision-review/SKILL.md first and follow it: one vision_reviews row per ' +
    'workspace under one review_id, a dated "still holds" or a proposed edit citing its ' +
    'evidence, the likes it read closed, and nothing written to module_visions. You change ' +
    'rows, not code. Do not commit or push.' +
    (opens === undefined ? '' : `\n\n${opensText(opens)}`)
  );
}

/**
 * The opens per workspace since `since` (all recorded opens when null), and
 * when recording began. Under the service role, so every read names the
 * account.
 */
export async function loadWindowOpens(
  supabase: SupabaseClient,
  userId: string,
  since: string | null,
): Promise<WindowOpens> {
  const core = supabase.schema('core');
  const [counted, firstView, firstDay] = await Promise.all([
    core.rpc('workspace_opens', { p_user_id: userId, p_since: since ?? '1970-01-01T00:00:00Z' }),
    core.from('page_views').select('viewed_at').eq('user_id', userId).order('viewed_at').limit(1),
    core.from('page_view_days').select('day').eq('user_id', userId).order('day').limit(1),
  ]);
  if (counted.error) throw new Error(`Could not count the page opens: ${counted.error.message}`);
  if (firstView.error) throw new Error(`Could not read the page views: ${firstView.error.message}`);
  if (firstDay.error) throw new Error(`Could not read the daily page views: ${firstDay.error.message}`);

  const firsts = [
    (firstView.data?.[0] as { viewed_at: string } | undefined)?.viewed_at,
    (firstDay.data?.[0] as { day: string } | undefined)?.day,
  ]
    .filter((at): at is string => typeof at === 'string')
    .map((at) => new Date(at).toISOString())
    .sort();

  const counts: WindowOpens['counts'] = {};
  const known = new Set<string>(MODULE_IDS);
  for (const row of (counted.data ?? []) as { workspace: string | null; opens: number; pages: number }[]) {
    const key = row.workspace !== null && known.has(row.workspace) ? (row.workspace as ModuleId) : 'outside';
    const before = counts[key] ?? { opens: 0, pages: 0 };
    counts[key] = { opens: before.opens + row.opens, pages: before.pages + row.pages };
  }
  return { since, recordingSince: firsts[0] ?? null, counts };
}

/** What the Dash tab shows about the review. */
export type VisionReviewStatus = {
  /** The newest of the last review written and the last fire that started. */
  lastRunAt: string | null;
  /** The last fire, when it failed after the last run; null otherwise. */
  failed: { at: string; error: string } | null;
  /** When the next weekly run is due, a week after the last one. */
  nextAt: string | null;
  /** Edits waiting on the person on the specs page. */
  pendingEdits: number;
};

export function visionReviewStatus(input: {
  lastFire: VisionFire | null;
  lastReviewAt: string | null;
  pendingEdits: number;
}): VisionReviewStatus {
  const { lastFire, lastReviewAt } = input;
  const times = [lastReviewAt, lastFire && lastFire.status !== 'failed' ? lastFire.at : null]
    .filter((at): at is string => at !== null)
    .map((at) => new Date(at).getTime())
    .filter(Number.isFinite);
  const last = times.length > 0 ? Math.max(...times) : null;

  const failed =
    lastFire && lastFire.status === 'failed' && (last === null || new Date(lastFire.at).getTime() > last)
      ? { at: lastFire.at, error: lastFire.error ?? 'The routine did not start.' }
      : null;

  return {
    lastRunAt: last === null ? null : new Date(last).toISOString(),
    failed,
    nextAt: last === null ? null : new Date(last + WEEK_MS).toISOString(),
    pendingEdits: input.pendingEdits,
  };
}

/** The last fire and the last review, the two reads both callers make. */
export async function loadVisionRunFacts(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ lastFire: VisionFire | null; lastReviewAt: string | null }> {
  const [fire, review] = await Promise.all([
    supabase
      .from('plan_runs')
      .select('status, created_at, error')
      .eq('user_id', userId)
      .eq('job', 'vision')
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('vision_reviews')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);
  if (fire.error) throw new Error(`Could not read the vision review fires: ${fire.error.message}`);
  if (review.error) throw new Error(`Could not read the vision reviews: ${review.error.message}`);

  const fireRow = (fire.data ?? [])[0] as
    | { status: string; created_at: string; error: string | null }
    | undefined;
  const reviewRow = (review.data ?? [])[0] as { created_at: string } | undefined;
  return {
    lastFire: fireRow
      ? {
          status:
            fireRow.status === 'failed' || fireRow.status === 'finished' ? fireRow.status : 'started',
          at: fireRow.created_at,
          error: fireRow.error,
        }
      : null,
    lastReviewAt: reviewRow?.created_at ?? null,
  };
}

/** The status for the Dash tab, or null when it could not be read. */
export async function loadVisionReviewStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<VisionReviewStatus | null> {
  try {
    const [facts, pending] = await Promise.all([
      loadVisionRunFacts(supabase, userId),
      supabase
        .from('vision_reviews')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'pending'),
    ]);
    return visionReviewStatus({ ...facts, pendingEdits: pending.count ?? 0 });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return null;
  }
}
