/**
 * The status of each open goal (plans #1018, #1074, #1084).
 *
 * Every day the daily run reads every open goal against its done-when and
 * writes a row to goals.reviews (supabase/migrations-goals/0025, 0046, 0052):
 * one of six verdicts, one sentence on why, one on the next move, and the
 * next move's date where it has one. A stalled goal also gets that next move
 * as a step under it, and the database refuses a stalled verdict without
 * one. A goal waiting on a date carries the date, and one waiting on another
 * goal names that goal. A goal whose done-when is met reads `met`, with a
 * summary of how it got there as the reason, and Today offers to close it
 * (lib/goals/goal-proposals.ts). The newest row per goal is its status, and
 * the Goals pages show it.
 *
 * What the run cannot see for itself is when anything was last done on a
 * goal, so the brief says it for each goal, measured here: the newest of a
 * step closed as done, a reading logged, a progress entry that was not
 * undone, a rhythm period with something counted in it, and a confirmed
 * record in one of the goal's collections, on the goal or any of its steps;
 * or the day the goal was approved when nothing has been done since.
 * Three weeks of nothing is stalled, and the brief says so outright rather
 * than leaving it to the run's reading.
 *
 * Pure. The reads are in lib/goals/reviews-store.ts.
 */
import { paceLine, type GoalPace } from '@/lib/goals/pace';
import type { Goal } from '@/lib/goals/tree';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Nothing done for this many days reads stalled, whatever else the goal has going. */
export const STALLED_AFTER_DAYS = 21;

export const VERDICTS = [
  'on_track',
  'stalled',
  'waiting_on_you',
  'waiting_on_date',
  'waiting_on_goal',
  'met',
  'pace_holding',
  'pace_slipping',
] as const;
export type Verdict = (typeof VERDICTS)[number];

export const VERDICT_LABELS: Record<Verdict, string> = {
  on_track: 'On track',
  stalled: 'Stalled',
  waiting_on_you: 'Waiting on you',
  waiting_on_date: 'Waiting on a date',
  waiting_on_goal: 'Waiting on another goal',
  met: 'Done-when met',
  pace_holding: 'Keeping its pace',
  pace_slipping: 'Slower than usual',
};

/**
 * How long a status counts as today's. The daily run writes one a day, so a
 * status older than this means a run was missed, and a page can say so
 * rather than show it as current.
 */
export const REVIEW_CURRENT_HOURS = 36;

/** Whether a review is recent enough to stand as the goal's status now. */
export function isCurrent(review: GoalReview, now: number): boolean {
  return now - Date.parse(review.createdAt) <= REVIEW_CURRENT_HOURS * 60 * 60 * 1000;
}

/**
 * The verdicts a goal judged on its pace can carry (plan #1738;
 * docs/GOALS-SPEC.md, "Goals without a deadline"). Waiting on you, stalled,
 * waiting on a date, on track and waiting on another goal are for goals with
 * a due date, errands and goals with a step on Todo.
 */
export const PACE_GOAL_VERDICTS: ReadonlySet<Verdict> = new Set<Verdict>([
  'met',
  'pace_holding',
  'pace_slipping',
]);

/** A step as `judgedOnPace` reads it: whether it is on Todo, and what is under it. */
type TodoStep = { status: string; onTodo: boolean; children?: readonly TodoStep[] };

/**
 * Whether a goal is judged on its pace rather than on what waits on whom: it
 * has no due date, is not an errand, and has no open step on Todo.
 */
export function judgedOnPace(
  goal: { dueOn?: string | null; errand?: boolean },
  steps: readonly TodoStep[],
): boolean {
  if (goal.dueOn || goal.errand) return false;
  const onTodo = (nodes: readonly TodoStep[]): boolean =>
    nodes.some(
      (node) =>
        (node.onTodo && node.status !== 'done' && node.status !== 'dropped') ||
        onTodo(node.children ?? []),
    );
  return !onTodo(steps);
}

/** An item as `pacedGoalIds` reads it, one row per goal or step. */
export type PaceItemRow = {
  id: string;
  parent_id: string | null;
  level: string;
  status: string;
  due_on: string | null;
  errand: boolean | null;
  on_todo: boolean | null;
};

/** The goals among `rows` that are judged on their pace (judgedOnPace), from flat rows. */
export function pacedGoalIds(rows: readonly PaceItemRow[]): Set<string> {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const goalOf = (row: PaceItemRow): string | null => {
    let item: PaceItemRow | undefined = row;
    for (let depth = 0; item && depth < 100; depth += 1) {
      if (item.level === 'goal') return item.id;
      item = item.parent_id ? byId.get(item.parent_id) : undefined;
    }
    return null;
  };
  const dated = new Set<string>();
  for (const row of rows) {
    if (row.level === 'goal' && (row.due_on || row.errand)) dated.add(row.id);
    if (row.level === 'step' && row.on_todo && row.status !== 'done' && row.status !== 'dropped') {
      const goalId = goalOf(row);
      if (goalId) dated.add(goalId);
    }
  }
  return new Set(rows.filter((row) => row.level === 'goal' && !dated.has(row.id)).map((row) => row.id));
}

/**
 * The reviews that still stand as each goal's status. A goal judged on its
 * pace keeps only a met or pace verdict, so a "Waiting on you" written before
 * it lost its date or its step on Todo, or before plan #1738, stops showing,
 * and a goal whose pace is not known yet shows no status at all.
 */
export function standingReviews(
  latest: ReadonlyMap<string, GoalReview>,
  paced: ReadonlySet<string>,
): Map<string, GoalReview> {
  const out = new Map<string, GoalReview>();
  for (const [goalId, review] of latest) {
    if (paced.has(goalId) && !PACE_GOAL_VERDICTS.has(review.verdict)) continue;
    out.set(goalId, review);
  }
  return out;
}

export function isVerdict(value: unknown): value is Verdict {
  return typeof value === 'string' && (VERDICTS as readonly string[]).includes(value);
}

export type GoalReview = {
  id: string;
  goalId: string;
  verdict: Verdict;
  reason: string;
  nextMove: string;
  /** The next move's date (YYYY-MM-DD), where it has one. Always set for waiting_on_date. */
  nextOn: string | null;
  /** The step a stalled verdict came with. */
  stepId: string | null;
  /** The other goal a waiting_on_goal verdict waits on. */
  waitsOnId: string | null;
  runId: string | null;
  createdAt: string;
};

export type ReviewRow = {
  id: string;
  item_id: string;
  verdict: string;
  reason: string;
  next_move: string;
  next_on: string | null;
  step_id: string | null;
  waits_on_id: string | null;
  run_id: string | null;
  created_at: string;
};

export const REVIEW_COLUMNS =
  'id, item_id, verdict, reason, next_move, next_on, step_id, waits_on_id, run_id, created_at';

/** A row as the app reads it, or null for a verdict this code does not know. */
export function toReview(row: ReviewRow): GoalReview | null {
  if (!isVerdict(row.verdict)) return null;
  return {
    id: row.id,
    goalId: row.item_id,
    verdict: row.verdict,
    reason: row.reason,
    nextMove: row.next_move,
    nextOn: row.next_on ?? null,
    stepId: row.step_id,
    waitsOnId: row.waits_on_id ?? null,
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

/**
 * Something done on a goal or one of its steps, at a time: a reading, or one
 * of the touches activityTouches makes from the other reads.
 */
export type ActivityReading = { item_id: string; created_at: string };

/** A progress entry as the activity read takes it; undone ones are left out by the store. */
export type ActivityProgress = { item_id: string; created_at: string };

/** A rhythm period with something counted in it. */
export type ActivityPeriod = { item_id: string; ends_on: string; updated_at: string };

/** A confirmed record, and the goals and steps its collection belongs to. */
export type ActivityRecord = { collection_id: string; updated_at: string };
export type ActivityCollection = { collection_id: string; item_id: string };

/**
 * Every touch besides a reading or a closed step, as item and time, so
 * goalActivity walks each one up to its goal:
 *
 * - a progress entry, when it was logged;
 * - a rhythm period with a count above nothing, when its count last changed,
 *   or the day it ended if that is earlier, since a count written by the
 *   sync after the period ended was done within it;
 * - a confirmed record, when it last changed, on each goal or information
 *   step its collection belongs to.
 */
export function activityTouches({
  progress = [],
  periods = [],
  records = [],
  collections = [],
}: {
  progress?: ActivityProgress[];
  periods?: ActivityPeriod[];
  records?: ActivityRecord[];
  collections?: ActivityCollection[];
}): ActivityReading[] {
  const out: ActivityReading[] = progress.map((entry) => ({ ...entry }));
  for (const period of periods) {
    const ended = `${period.ends_on}T00:00:00Z`;
    out.push({ item_id: period.item_id, created_at: period.updated_at < ended ? period.updated_at : ended });
  }
  const owners = new Map<string, string[]>();
  for (const link of collections) {
    const list = owners.get(link.collection_id) ?? [];
    list.push(link.item_id);
    owners.set(link.collection_id, list);
  }
  for (const record of records) {
    for (const itemId of owners.get(record.collection_id) ?? []) {
      out.push({ item_id: itemId, created_at: record.updated_at });
    }
  }
  return out;
}

export type GoalActivity = {
  /** The newest thing done on the goal (see goalActivity); null when there is none. */
  lastDoneAt: string | null;
  /** When the goal was approved, or added when it has no approval on record. */
  since: string | null;
};

/**
 * When anything was last done on each goal: the newest step closed as done
 * and the newest of `readings` (readings, and the touches activityTouches
 * makes), whichever is later, found by walking each step up to its goal.
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

/** A goal as the daily brief lists it for review. */
export type ReviewGoal = {
  id: string;
  title: string;
  acceptance: string | null;
  lastDoneAt: string | null;
  /** Whole days since anything was done, or since the goal was approved when nothing has been. */
  quietDays: number | null;
  /** Three weeks of nothing: the verdict has to be stalled. */
  stalled: boolean;
  /** The last verdict, when there was one. */
  last: GoalReview | null;
  /** When you last kept it open against a proposal to close or park it (plan #1084). */
  keptOpenAt?: string | null;
  /**
   * Set when the goal is judged on its pace (judgedOnPace; plan #1738): its
   * pace from lib/goals/pace.ts, or null when it could not be read. Absent
   * for a goal with a due date, an errand, or a goal with a step on Todo.
   */
  pace?: GoalPace | null;
};

/**
 * Every open goal, in tree order, with what the review needs to know about
 * it. `paces` holds an entry for each goal judged on its pace (plan #1738),
 * which is never forced to stalled: three quiet weeks on a goal with no
 * deadline read as slower than usual, or as nothing while its pace is unknown.
 */
export function reviewGoals(
  goals: Goal[],
  activity: Map<string, GoalActivity>,
  latest: Map<string, GoalReview>,
  now: number,
  paces: ReadonlyMap<string, GoalPace | null> = new Map(),
): ReviewGoal[] {
  return goals
    .filter((g) => g.status === 'open')
    .map((g) => {
      const seen = activity.get(g.id);
      const from = seen?.lastDoneAt ?? seen?.since ?? null;
      const quietDays = from === null ? null : Math.max(0, Math.floor((now - Date.parse(from)) / DAY_MS));
      const paced = paces.has(g.id);
      return {
        id: g.id,
        title: g.title,
        acceptance: g.acceptance,
        lastDoneAt: seen?.lastDoneAt ?? null,
        quietDays,
        stalled: !paced && quietDays !== null && quietDays >= STALLED_AFTER_DAYS,
        last: latest.get(g.id) ?? null,
        keptOpenAt: g.keptOpenAt ?? null,
        ...(paced ? { pace: paces.get(g.id) ?? null } : {}),
      };
    });
}

function day(at: string): string {
  return at.slice(0, 10);
}

/** The verdict a goal judged on its pace takes, unless its done-when is met; null for no row. */
export function paceVerdict(pace: GoalPace | null): 'pace_holding' | 'pace_slipping' | null {
  if (!pace || !pace.known) return null;
  return pace.slower ? 'pace_slipping' : 'pace_holding';
}

/** The brief's line on how a goal judged on its pace is to be read. */
function paceBriefLine(pace: GoalPace | null): string {
  const lead = '- No due date and nothing on Todo, so it is judged on its pace, never waiting on you, stalled or waiting on a date.';
  const verdict = paceVerdict(pace);
  if (pace === null) {
    return `${lead} Its pace could not be read today: write no row unless its done-when is met.`;
  }
  if (verdict === null) {
    const last = paceLine(pace);
    return `${lead} Too little history for a pace yet (${pace.activeDays} active days in six weeks${last ? `, ${last}` : ''}): write no row unless its done-when is met.`;
  }
  return `${lead} Its pace: ${paceLine(pace)}. The verdict is ${verdict} (${VERDICT_LABELS[verdict].toLowerCase()}) unless its done-when is met.`;
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
    ...(goal.pace !== undefined ? [paceBriefLine(goal.pace)] : []),
    ...(goal.stalled
      ? [
          `- Nothing done in ${STALLED_AFTER_DAYS} days or more: the verdict is stalled, with its next step added under it, unless its done-when is met.`,
        ]
      : []),
    ...(goal.last
      ? [`- Last verdict (${day(goal.last.createdAt)}): ${VERDICT_LABELS[goal.last.verdict].toLowerCase()}. ${goal.last.reason}`]
      : []),
    ...(goal.keptOpenAt
      ? [
          `- The person kept it open on ${day(goal.keptOpenAt)} rather than close or park it. Read it as met again only on something done since then.`,
        ]
      : []),
  ];
}
