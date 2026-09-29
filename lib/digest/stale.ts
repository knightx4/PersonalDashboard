import type { SupabaseClient } from '@supabase/supabase-js';
import type { PlanItem } from '@/lib/plan/load';

/**
 * Handing a stale-looking block to a session instead of the ideas page
 * (plan #1224).
 *
 * The morning run has no way to act on a block, so until now an idea was the
 * only thing it could write about one. The one case in the evidence, #985,
 * was blocked for a real reason (a done-when line needed a real run), and the
 * model read "the code is on main" as clear to move. So the run never changes
 * a plan row itself. A step it thinks is stale gets a check-back, woken like
 * any other and under the same three-a-day limit, and the session reads the
 * block and the code before it moves anything.
 */

/** What the model reported, as far as this reads it. */
export type StaleCandidate = {
  title: string;
  detail: string | null;
  step?: number | null;
  kind?: 'stale_block' | 'other';
};

/** The fields of a plan row this reads. */
export type BlockedRow = Pick<PlanItem, 'id' | 'number' | 'title' | 'status' | 'kind' | 'blockAsk'>;

export type StaleHandoff<T> = { suggestion: T; step: BlockedRow };

/** Where the check-backs say they came from, on the Dash tab and in the woken brief. */
export const MORNING_RUN_SOURCE = 'morning run';

/**
 * Splits what the model suggested into the stale blocks a session should
 * settle and everything else, which is filed as it always was.
 *
 * A suggestion goes to a session only when the model called it a stale block
 * and named a build step that is blocked now. A decision never does: an open
 * question stays the person's, whoever thinks it is settled. A stale-block
 * suggestion about a step that is not blocked, or no step at all, falls
 * through to the rest.
 */
export function splitStaleBlocks<T extends StaleCandidate>(
  suggestions: readonly T[],
  items: readonly BlockedRow[],
): { handoffs: StaleHandoff<T>[]; rest: T[] } {
  const byNumber = new Map(items.map((item) => [item.number, item]));
  const handoffs: StaleHandoff<T>[] = [];
  const rest: T[] = [];

  for (const suggestion of suggestions) {
    const step = suggestion.step == null ? undefined : byNumber.get(suggestion.step);
    if (
      suggestion.kind === 'stale_block' &&
      step &&
      step.status === 'blocked' &&
      step.kind === 'build'
    ) {
      handoffs.push({ suggestion, step });
    } else {
      rest.push(suggestion);
    }
  }
  return { handoffs, rest };
}

/** The check-back's title: what the woken session is asked to look at. */
export function staleTitle(step: Pick<BlockedRow, 'number' | 'title'>): string {
  return `Is the block on #${step.number} still holding? ${step.title}`.slice(0, 200);
}

/**
 * The check-back's detail: what the run noticed, what the step says it is
 * waiting for, and the three ways a session may close it.
 */
export function staleDetail(handoff: StaleHandoff<StaleCandidate>): string {
  const { suggestion, step } = handoff;
  const noticed = [suggestion.title.trim(), suggestion.detail?.trim()].filter(Boolean).join(' ');
  return [
    `The morning run thinks #${step.number} is blocked on something that has since happened: "${noticed}"`,
    `What the block says it waits for: ${step.blockAsk?.trim() || 'nothing recorded; read the comment on the step.'}`,
    `Read the block and the code before moving anything; the run has not. Then do one of three things:`,
    `1. What it waited on has happened: unblock it (npx tsx scripts/plan.ts reopen ${step.number}).`,
    `2. Its done-when is met and its commit is on main: close it with a note (done ${step.number} --note "…").`,
    `3. It is still waiting: block it again with an ask that says what for now (block ${step.number} --ask "…").`,
    `An open decision it waits on is the person's; do not answer it.`,
  ]
    .join('\n')
    .slice(0, 4000);
}

/**
 * Writes one waiting check-back per stale block, due now and woken like any
 * other, and returns how many it wrote.
 *
 * A step that already has a waiting check-back gets no second one, whoever
 * wrote the first, so the same suggestion the next morning writes nothing
 * new. A failed read throws, since without it every step would get another;
 * a failed insert is logged and skipped, the same as a filed idea.
 */
export async function fileStaleCheckBacks(
  supabase: SupabaseClient,
  userId: string,
  handoffs: readonly StaleHandoff<StaleCandidate>[],
  now: Date,
): Promise<number> {
  if (handoffs.length === 0) return 0;

  const { data, error } = await supabase
    .from('check_backs')
    .select('plan_item_id')
    .eq('user_id', userId)
    .eq('status', 'waiting')
    .in(
      'plan_item_id',
      handoffs.map((handoff) => handoff.step.id),
    );
  if (error) throw new Error(`Reading waiting check-backs failed: ${error.message}`);

  const waiting = new Set(
    (data ?? []).map((row) => String((row as { plan_item_id: string }).plan_item_id)),
  );
  let written = 0;

  for (const handoff of handoffs) {
    if (waiting.has(handoff.step.id)) continue;

    const { error: insertError } = await supabase.from('check_backs').insert({
      user_id: userId,
      title: staleTitle(handoff.step),
      detail: staleDetail(handoff),
      due_at: now.toISOString(),
      plan_item_id: handoff.step.id,
      source: MORNING_RUN_SOURCE,
      wake: true,
    });
    if (insertError) {
      console.error('[dev digest] check-back not written', insertError.message);
      continue;
    }
    waiting.add(handoff.step.id);
    written += 1;
  }
  return written;
}
