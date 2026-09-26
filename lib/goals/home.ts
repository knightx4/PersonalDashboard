/**
 * The Goals home (plan #1077, under #1072): a one-sentence summary, Today,
 * every open goal on one line under its area, and what Dash did since your
 * last visit.
 *
 * This file is the goal lines and the summary. Today is lib/goals/today.ts
 * and what Dash did is lib/goals/done-since.ts; the reads for all three are
 * in lib/goals/home-store.ts.
 *
 * Pure, so the wording is tested without a database.
 */
import type { NextItem } from '@/lib/goals/daily';
import type { GoalReview, Verdict } from '@/lib/goals/reviews';
import type { GoalProgress } from '@/lib/goals/status';
import type { Goal } from '@/lib/goals/tree';

/** One open goal as its line on the home reads it. */
export type HomeGoal = {
  goal: Goal;
  areaName: string;
  progress: GoalProgress;
  /** Dash's newest status on it, or null when it has never had one. */
  review: GoalReview | null;
  /** Whether that status is recent enough to stand as today's (isCurrent). */
  current: boolean;
  /** Its first next step, which stands in for the next move when there is no status. */
  next: NextItem | null;
  /** Whether it has any live steps, so a goal with none can be offered a breakdown. */
  hasSteps: boolean;
};

export type HomeArea = { areaId: string; areaName: string; goals: HomeGoal[] };

/** The goals in page order, gathered under their areas in the order the areas first come. */
export function homeAreas(goals: readonly HomeGoal[]): HomeArea[] {
  const groups = new Map<string, HomeArea>();
  for (const line of goals) {
    const group = groups.get(line.goal.areaId) ?? {
      areaId: line.goal.areaId,
      areaName: line.areaName,
      goals: [],
    };
    group.goals.push(line);
    groups.set(line.goal.areaId, group);
  }
  return [...groups.values()];
}

/**
 * The next move a goal line shows, and its date: the status's when there is
 * one, since the run chose it with the whole goal in view, and otherwise the
 * goal's first next step. Null when there is neither.
 */
export function nextMove(line: HomeGoal): { text: string; on: string | null } | null {
  if (line.review) return { text: line.review.nextMove, on: line.review.nextOn };
  if (line.next) return { text: line.next.title, on: line.next.dueOn };
  return null;
}

/** The order the summary names the verdicts in: what needs you first. */
const SUMMARY_ORDER: (Verdict | 'none')[] = [
  'waiting_on_you',
  'stalled',
  'on_track',
  'waiting_on_date',
  'waiting_on_goal',
  'none',
];

/** What a count of goals "is" or "are", singular and plural. */
const SUMMARY_VERBS: Record<Verdict | 'none', [string, string]> = {
  waiting_on_you: ['is waiting on you', 'are waiting on you'],
  stalled: ['has stalled', 'have stalled'],
  on_track: ['is on track', 'are on track'],
  waiting_on_date: ['is waiting on a date', 'are waiting on a date'],
  waiting_on_goal: ['is waiting on another goal', 'are waiting on another goal'],
  none: ['has no status yet', 'have no status yet'],
};

/**
 * One sentence on where the goals stand, from their statuses: "3 of your 7
 * goals are waiting on you, 2 are on track and 2 are waiting on a date."
 * Null when there are no open goals.
 */
export function homeSummary(goals: readonly Pick<HomeGoal, 'review'>[]): string | null {
  const total = goals.length;
  if (total === 0) return null;
  const counts = new Map<Verdict | 'none', number>();
  for (const { review } of goals) {
    const key = review?.verdict ?? 'none';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = SUMMARY_ORDER.filter((key) => (counts.get(key) ?? 0) > 0).map((key) => {
    const n = counts.get(key)!;
    return { n, verb: SUMMARY_VERBS[key][n === 1 ? 0 : 1] };
  });

  const [first, ...rest] = parts;
  const lead =
    first.n === total
      ? total === 1
        ? `Your one goal ${first.verb}`
        : `All ${total} of your goals ${first.verb}`
      : `${first.n} of your ${total} goals ${first.verb}`;
  const clauses = [lead, ...rest.map((part) => `${part.n} ${part.verb}`)];
  const sentence =
    clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`;
  return `${sentence}.`;
}
