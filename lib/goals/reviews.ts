/**
 * The weekly verdict on each open goal (plan #1018).
 *
 * Once a week the weekly run reads every open goal against its done-when and
 * writes a row to goals.reviews (supabase/migrations-goals/0025): on track,
 * stalled or waiting on you, one sentence on why and one on the next move. A
 * stalled goal also gets that next move as a step under it, and the
 * database refuses a stalled verdict without one. The Goals home shows the
 * newest verdict on each goal's card.
 *
 * What the run cannot see for itself is when anything was last done on a
 * goal, so the brief says it for each goal, measured here: the newest of a
 * step closed as done and a reading logged against the goal or one of its
 * steps, or the day the goal was approved when nothing has been done since.
 * Three weeks of nothing is stalled, and the brief says so outright rather
 * than leaving it to the run's reading.
 *
 * Pure. The reads are in lib/goals/reviews-store.ts.
 */
import type { Goal } from '@/lib/goals/tree';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Nothing done for this many days reads stalled, whatever else the goal has going. */
export const STALLED_AFTER_DAYS = 21;

export const VERDICTS = ['on_track', 'stalled', 'waiting_on_you'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  on_track: 'On track',
  stalled: 'Stalled',
  waiting_on_you: 'Waiting on you',
};

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === 'string' && (VERDICTS as readonly string[]).includes(value);
}

export type GoalReview = {
  id: string;
  goalId: string;
  verdict: Verdict;
  reason: string;
  nextMove: string;
  /** The step a stalled verdict came with. */
  stepId: string | null;
  runId: string | null;
  createdAt: string;
};

export type ReviewRow = {
  id: string;
  item_id: string;
  verdict: string;
  reason: string;
  next_move: string;
  step_id: string | null;
  run_id: string | null;
  created_at: string;
};

export const REVIEW_COLUMNS = 'id, item_id, verdict, reason, next_move, step_id, run_id, created_at';

/** A row as the app reads it, or null for a verdict this code does not know. */
export function toReview(row: ReviewRow): GoalReview | null {
  if (!isVerdict(row.verdict)) return null;
  return {
    id: row.id,
    goalId: row.item_id,
    verdict: row.verdict,
    reason: row.reason,
    nextMove: row.next_move,
    stepId: row.step_id,
    runId: row.run_id,
    createdAt: row.created_at,
  };
}

/** The newest review of each goal, from rows in any order. */
export function latestByGoal(reviews: GoalReview[]): Map<string, GoalReview> {
  const latest = new Map<string, GoalReview>();
  for (const review of reviews) {
    const held = latest.get(review.goalId);
    if (!held || review.createdAt > held.createdAt) latest.set(review.goalId, review);
  }
  return latest;
}

/** An item as the activity read takes it: enough to find its goal and whether it was done. */
export type ActivityItem = {
  id: string;
  parent_id: string | null;
  level: string;
  status: string;
  closed_at?: string | null;
  approved_at?: string | null;
  created_at?: string | null;
};

/** A reading, on a goal or on one of its steps. */
export type ActivityReading = { item_id: string; created_at: string };

export type GoalActivity = {
  /** The newest step closed as done, or reading logged; null when there is none. */
  lastDoneAt: string | null;
  /** When the goal was approved, or added when it has no approval on record. */
  since: string | null;
};

/**
 * When anything was last done on each goal: the newest step closed as done
 * and the newest reading, whichever is later, found by walking each step up
 * to its goal.
 */
export function goalActivity(
  items: ActivityItem[],
  readings: ActivityReading[],
): Map<string, GoalActivity> {
  const byId = new Map(items.map((item) => [item.id, item]));
  const goalOf = (id: string): string | null => {
    let item = byId.get(id);
    for (let depth = 0; item && depth < 100; depth += 1) {
      if (item.level === 'goal') return item.id;
      item = item.parent_id ? byId.get(item.parent_id) : undefined;
    }
    return null;
  };

  const activity = new Map<string, GoalActivity>();
  for (const item of items) {
    if (item.level !== 'goal') continue;
    activity.set(item.id, { lastDoneAt: null, since: item.approved_at ?? item.created_at ?? null });
  }
  const touch = (itemId: string, at: string | null | undefined) => {
    if (!at) return;
    const goalId = goalOf(itemId);
    const held = goalId ? activity.get(goalId) : undefined;
    if (held && (held.lastDoneAt === null || at > held.lastDoneAt)) held.lastDoneAt = at;
  };
  for (const item of items) {
    if (item.level === 'step' && item.status === 'done') touch(item.id, item.closed_at);
  }
  for (const reading of readings) touch(reading.item_id, reading.created_at);
  return activity;
}

/** A goal as the weekly brief lists it for review. */
export type ReviewGoal = {
  id: string;
  title: string;
  acceptance: string | null;
  lastDoneAt: string | null;
  /** Whole days since anything was done, or since the goal was approved when nothing has been. */
  quietDays: number | null;
  /** Three weeks of nothing: the verdict has to be stalled. */
  stalled: boolean;
  /** Last week's verdict, when there was one. */
  last: GoalReview | null;
};

/** Every open goal, in tree order, with what the review needs to know about it. */
export function reviewGoals(
  goals: Goal[],
  activity: Map<string, GoalActivity>,
  latest: Map<string, GoalReview>,
  now: number,
): ReviewGoal[] {
  return goals
    .filter((g) => g.status === 'open')
    .map((g) => {
      const seen = activity.get(g.id);
      const from = seen?.lastDoneAt ?? seen?.since ?? null;
      const quietDays = from === null ? null : Math.max(0, Math.floor((now - Date.parse(from)) / DAY_MS));
      return {
        id: g.id,
        title: g.title,
        acceptance: g.acceptance,
        lastDoneAt: seen?.lastDoneAt ?? null,
        quietDays,
        stalled: quietDays !== null && quietDays >= STALLED_AFTER_DAYS,
        last: latest.get(g.id) ?? null,
      };
    });
}

function day(at: string): string {
  return at.slice(0, 10);
}

/** The brief's lines for one goal under review. */
export function reviewLines(goal: ReviewGoal): string[] {
  const done =
    goal.lastDoneAt !== null
      ? `Last thing done: ${day(goal.lastDoneAt)}, ${goal.quietDays} days ago.`
      : goal.quietDays !== null
        ? `Nothing done since it was approved ${goal.quietDays} days ago.`
        : 'Nothing done on record.';
  return [
    `Goal "${goal.title}" (goals.items id ${goal.id})`,
    `- Done when: ${goal.acceptance ?? 'not written yet'}`,
    `- ${done}`,
    ...(goal.stalled
      ? [
          `- Nothing done in ${STALLED_AFTER_DAYS} days or more: the verdict is stalled, with its next step added under it.`,
        ]
      : []),
    ...(goal.last
      ? [`- Last verdict (${day(goal.last.createdAt)}): ${VERDICT_LABELS[goal.last.verdict].toLowerCase()}. ${goal.last.reason}`]
      : []),
  ];
}
