import type { SupabaseClient } from '@supabase/supabase-js';

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

/** The turn appended to the routine's session: whose visions, and how. */
export function visionRunText(userId: string): string {
  return (
    `Run the weekly vision review for user_id ${userId}. Read ` +
    '.claude/skills/vision-review/SKILL.md first and follow it: one vision_reviews row per ' +
    'workspace under one review_id, a dated "still holds" or a proposed edit citing its ' +
    'evidence, the likes it read closed, and nothing written to module_visions. You change ' +
    'rows, not code. Do not commit or push.'
  );
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
