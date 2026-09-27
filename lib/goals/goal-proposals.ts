/**
 * Proposals to close or park a goal (plan #1084, under #1073).
 *
 * Two things Today offers on a whole goal, each with one button. Both moves
 * stay yours: the database refuses Claude any change to a goal's status
 * (items_claude_guard), so the button is your own write.
 *
 * - Close, when the morning run read the goal's done-when as met: its newest
 *   verdict is `met`, current, and its reason is the summary of how the goal
 *   got there.
 * - Park, when nothing has been done on the goal for STALLED_AFTER_DAYS: no
 *   step closed as done and no reading logged, counted from when it was
 *   approved when nothing has been done since. A parked goal keeps its steps
 *   and leaves the home and the runs until you take it back up.
 *
 * Keeping a goal open answers both (items.kept_open_at, 0052): a met verdict
 * older than it is not offered again, and the three weeks count from it. A
 * goal offered for closing is not also offered for parking.
 *
 * Pure. Today's reads are in lib/goals/today-store.ts.
 */
import { isCurrent, STALLED_AFTER_DAYS, type GoalActivity, type GoalReview } from '@/lib/goals/reviews';
import type { Goal } from '@/lib/goals/tree';

const DAY_MS = 24 * 60 * 60 * 1000;

export type GoalProposal =
  | { kind: 'close'; goalId: string; goalTitle: string; summary: string }
  | { kind: 'park'; goalId: string; goalTitle: string; quietDays: number };

export type GoalProposalInput = {
  goals: readonly Pick<Goal, 'id' | 'title' | 'status' | 'keptOpenAt'>[];
  /** The newest review of each goal (loadLatestReviews). */
  reviews: ReadonlyMap<string, GoalReview>;
  /** When anything was last done on each goal (loadGoalActivity). */
  activity: ReadonlyMap<string, GoalActivity>;
  now: number;
};

/** The later of two instants, either of which may be missing. */
function later(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * Whole days since anything was done on a goal, or since it was approved or
 * kept open, whichever is latest. Null when none of them is known.
 */
export function quietDays(
  activity: GoalActivity | undefined,
  keptOpenAt: string | null | undefined,
  now: number,
): number | null {
  const from = later(activity?.lastDoneAt ?? activity?.since ?? null, keptOpenAt);
  if (from === null) return null;
  return Math.max(0, Math.floor((now - Date.parse(from)) / DAY_MS));
}

/** One proposal per open goal at most, in the order the goals come. */
export function goalProposals(input: GoalProposalInput): GoalProposal[] {
  const out: GoalProposal[] = [];
  for (const goal of input.goals) {
    if (goal.status !== 'open') continue;
    const keptOpenAt = goal.keptOpenAt ?? null;
    const review = input.reviews.get(goal.id);
    if (
      review?.verdict === 'met' &&
      isCurrent(review, input.now) &&
      (keptOpenAt === null || Date.parse(review.createdAt) > Date.parse(keptOpenAt))
    ) {
      out.push({ kind: 'close', goalId: goal.id, goalTitle: goal.title, summary: review.reason });
      continue;
    }
    const quiet = quietDays(input.activity.get(goal.id), keptOpenAt, input.now);
    if (quiet !== null && quiet >= STALLED_AFTER_DAYS) {
      out.push({ kind: 'park', goalId: goal.id, goalTitle: goal.title, quietDays: quiet });
    }
  }
  return out;
}
