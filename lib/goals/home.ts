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
 * The open errands, soonest due first (plan #1262), and the other goals in
 * page order. An errand is listed once, in Errands above the areas, rather
 * than under its area as well. An errand always has a due date; one read
 * without it sorts last.
 */
export function splitErrands(goals: readonly HomeGoal[]): {
  errands: HomeGoal[];
  others: HomeGoal[];
} {
  const errands = goals
    .filter((line) => line.goal.errand)
    .sort((a, b) => {
      const x = a.goal.dueOn ?? '9999-12-31';
      const y = b.goal.dueOn ?? '9999-12-31';
      return x < y ? -1 : x > y ? 1 : 0;
    });
  return { errands, others: goals.filter((line) => !line.goal.errand) };
}

/**
 * The area a new errand goes in unless you pick another: the area of the
 * soonest errand, since errands tend to share one, and otherwise the first
 * area. Null when there are no areas.
 */
export function errandAreaDefault(
  errands: readonly HomeGoal[],
  areas: readonly { id: string }[],
): string | null {
  const soonest = errands.find((line) => areas.some((area) => area.id === line.goal.areaId));
  return soonest?.goal.areaId ?? areas[0]?.id ?? null;
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
  'met',
  'waiting_on_you',
  'stalled',
  'on_track',
  'waiting_on_date',
  'waiting_on_goal',
  'none',
];

/** What a count of goals "is" or "are", singular and plural. */
const SUMMARY_VERBS: Record<Verdict | 'none', [string, string]> = {
  met: ['has met its done-when', 'have met their done-when'],
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

// ---------------------------------------------------------------------------
// This week (plan #1079): four numbers at the bottom of the home that say
// whether Goals is working.
// ---------------------------------------------------------------------------

/** How long a step of yours goes without a change before it counts as stuck. */
export const STUCK_DAYS = 7;

/** How many days of visits goals.visits.visit_days keeps (migrations-goals/0047). */
export const VISIT_DAYS_KEPT = 28;

/** The four numbers, for the week holding today. */
export type WeekHealth = {
  /** Dash's steps closed as done this week. */
  dashFinished: number;
  /** Everything on you now: Today and what is folded under it. */
  waitingOnYou: number;
  /** Your open steps that nothing has changed for STUCK_DAYS. */
  stuck: number;
  /** The days this week you opened the Goals home. */
  daysVisited: number;
};

/** A week as days (YYYY-MM-DD, `endsOn` excluded) and as instants (`to` excluded). */
export type WeekSpan = { startsOn: string; endsOn: string; from: string; to: string };

/**
 * The visit days after a visit today: today added once, oldest first, and
 * nothing older than VISIT_DAYS_KEPT days kept.
 */
export function nextVisitDays(days: readonly string[], today: string): string[] {
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - (VISIT_DAYS_KEPT - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return [...new Set([...days, today])].filter((day) => day >= oldest && day <= today).sort();
}

/** The step shape stuckSteps reads: a node of the live tree. */
type StuckNode = {
  id: string;
  kind: string;
  status: string;
  children: StuckNode[];
  waitingOn?: unknown[];
  waitsUntil?: string;
};

/**
 * How many of your steps are stuck: open steps of yours under an open goal,
 * with no open step beneath them (their sub-steps are the thing to do), not
 * waiting on another step or a later start date, and unchanged for
 * STUCK_DAYS. `updatedAt` holds each step's last change; a step missing from
 * it is not counted. A step under one that is closed, dropped or blocked is
 * not counted either, since the step above it settles it.
 */
export function stuckSteps(
  goals: readonly { goal: { id: string; status: string } }[],
  byGoal: ReadonlyMap<string, readonly StuckNode[]>,
  updatedAt: ReadonlyMap<string, string>,
  now: number,
): number {
  const cutoff = now - STUCK_DAYS * 86_400_000;
  let count = 0;
  const visit = (node: StuckNode) => {
    if (node.status !== 'open') return;
    const openChildren = node.children.filter((child) => child.status === 'open');
    if (openChildren.length > 0) {
      openChildren.forEach(visit);
      return;
    }
    if (node.kind !== 'mine') return;
    if ((node.waitingOn?.length ?? 0) > 0 || node.waitsUntil) return;
    const changed = updatedAt.get(node.id);
    if (changed !== undefined && Date.parse(changed) < cutoff) count += 1;
  };
  for (const { goal } of goals) {
    if (goal.status !== 'open') continue;
    (byGoal.get(goal.id) ?? []).forEach(visit);
  }
  return count;
}

/** The four numbers from what the store read. */
export function weekHealth(input: {
  week: WeekSpan;
  /** When each of Dash's done steps was closed. */
  dashClosedAt: readonly string[];
  waitingOnYou: number;
  stuck: number;
  visitDays: readonly string[];
}): WeekHealth {
  const from = Date.parse(input.week.from);
  const to = Date.parse(input.week.to);
  return {
    dashFinished: input.dashClosedAt.filter((at) => {
      const t = Date.parse(at);
      return t >= from && t < to;
    }).length,
    waitingOnYou: input.waitingOnYou,
    stuck: input.stuck,
    daysVisited: new Set(
      input.visitDays.filter((day) => day >= input.week.startsOn && day < input.week.endsOn),
    ).size,
  };
}
