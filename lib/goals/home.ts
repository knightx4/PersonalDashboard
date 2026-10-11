/**
 * The Goals home (plan #1077, under #1072): a one-sentence summary, Do next
 * from the week's focus goals, the other goals one line each, and what Dash
 * did since your last visit.
 *
 * This file is the goal lines, the summary, which goals are in focus, and
 * the split of what is on you into Do next and the rest. The ranking is
 * lib/goals/today.ts and what Dash did is lib/goals/done-since.ts; the reads
 * are in lib/goals/home-store.ts.
 *
 * Pure, so the wording is tested without a database.
 */
import { areaHref } from '@/lib/goals/all-goals';
import { inFocus } from '@/lib/goals/focus';
import type { NextItem } from '@/lib/goals/daily';
import type { GoalReview, Verdict } from '@/lib/goals/reviews';
import type { GoalProgress } from '@/lib/goals/status';
import type { TodayItem, TodayKind } from '@/lib/goals/today';
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

/** One of the buttons above Do next: an area, its page and how many open goals it holds. */
export type AreaButton = { id: string; name: string; href: string; goals: number };

/**
 * The buttons to each area's page, above Do next (note d79a0005): every live
 * area in the order the areas are kept, with the count of its open goals.
 */
export function areaButtons(
  areas: readonly { id: string; name: string }[],
  goals: readonly { goal: { areaId: string } }[],
): AreaButton[] {
  return areas.map((area) => ({
    id: area.id,
    name: area.name,
    href: areaHref(area.id),
    goals: goals.filter((line) => line.goal.areaId === area.id).length,
  }));
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
  errands: readonly { goal: { areaId: string } }[],
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
// Visit days. goals.visits keeps the days you opened the home (plan #1079);
// nothing on the home counts them now, but each visit still records them.
// ---------------------------------------------------------------------------

/** How many days of visits goals.visits.visit_days keeps (migrations-goals/0047). */
export const VISIT_DAYS_KEPT = 28;

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

// ---------------------------------------------------------------------------
// Do next and Other goals: what the home lists from the week's focus goals.
// ---------------------------------------------------------------------------

// Which goals are in focus is lib/goals/focus.ts's inFocus, the rule Todo and
// Dash's runs read too.

/**
 * The kinds of thing on you that Do next takes from any goal. A question, a
 * flag, or proposed steps or goals waiting on your approval hold up work
 * wherever they are, so they are not left out because their goal is not one
 * of this week's.
 */
export const ANY_GOAL_KINDS: ReadonlySet<TodayKind> = new Set<TodayKind>([
  'question',
  'ask',
  'flag',
  'breakdown',
  'plan',
]);

export type HomeLists = {
  /** The first `cap` of what is on you in the week's goals, ranked. */
  doNext: TodayItem[];
  /** The rest of it, in the same order, folded under Later. */
  rest: TodayItem[];
  /** The goals Do next leaves out, errands first, each shown as one line. */
  otherGoals: HomeGoal[];
};

/**
 * Splits everything ranked as on you (todayRanked) into Do next, the first
 * `cap` (TODAY_CAP, passed in so this file stays free of the ranking's
 * imports in the browser), and the rest, keeping what belongs to a goal in focus and anything of
 * ANY_GOAL_KINDS. Other goals is every goal out of focus, plus an errand
 * with no row in Do next, so a dated errand always shows somewhere.
 */
export function homeLists(
  ranked: readonly TodayItem[],
  goals: readonly HomeGoal[],
  today: string | undefined,
  cap: number,
): HomeLists {
  const all = goals.map((line) => line.goal);
  const focused = new Set(
    all.filter((goal) => inFocus(goal, all, today)).map((goal) => goal.id),
  );
  const kept = ranked.filter((item) => ANY_GOAL_KINDS.has(item.kind) || focused.has(item.goalId));
  const doNext = kept.slice(0, cap);
  const listed = new Set(doNext.map((item) => item.goalId));
  const { errands, others } = splitErrands(goals);
  const otherGoals = [...errands, ...others].filter(
    (line) => !focused.has(line.goal.id) || (line.goal.errand && !listed.has(line.goal.id)),
  );
  return { doNext, rest: kept.slice(cap), otherGoals };
}

/**
 * Dash's morning note cut for the home: its first paragraph, and the rest
 * for More, or null when there is no more.
 */
export function briefParts(body: string): { lead: string; rest: string | null } {
  const trimmed = body.trim();
  const split = trimmed.search(/\n\s*\n/);
  if (split < 0) return { lead: trimmed, rest: null };
  return { lead: trimmed.slice(0, split).trim(), rest: trimmed.slice(split).trim() || null };
}

/** How many lines of Dash's prepared text a Do next row shows before Open. */
export const EXCERPT_LINES = 3;

/**
 * The first lines of what Dash prepared, as plain text: blank lines dropped,
 * and the markdown marks at the start of a line (headings, bullets, check
 * boxes, quotes, numbers) and around words (bold, italics, code) taken off.
 */
export function preparedExcerpt(text: string, lines = EXCERPT_LINES): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
        .replace(/(\*\*|__|\*|_|`)(.+?)\1/g, '$2')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, lines)
    .join('\n');
}

