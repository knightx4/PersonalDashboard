/**
 * The three views over All goals (plan #1158): the goals still open, the
 * goals with something waiting on you, and every goal including finished and
 * archived ones. The same chips a goal's steps have (plan #1157), so the
 * words and the address match; the step views' Ready and To read are left
 * off, since they are about steps rather than goals.
 *
 * "On you" is what the home's Today list gathers (lib/goals/today.ts), counted
 * per goal: your open steps, questions, approvals and rhythms behind. A goal
 * Dash proposed is on you as well, since it waits for your approval.
 *
 * Pure, so the narrowing is tested without a page.
 */
import { DEFAULT_GOAL_VIEW, GOAL_VIEW_CHIPS, type GoalView } from '@/lib/goals/plan-rows';
import type { AreaWithGoals, Goal } from '@/lib/goals/tree';

export type AllGoalsView = (typeof GOAL_VIEW_CHIPS)[number];

export const ALL_GOALS_VIEWS: readonly AllGoalsView[] = GOAL_VIEW_CHIPS;

export function isAllGoalsView(value: GoalView | string): value is AllGoalsView {
  return (ALL_GOALS_VIEWS as readonly string[]).includes(value);
}

/** The view a `?view=` parameter asks for, or Open when it names none of the three. */
export function allGoalsViewOf(param: string | string[] | undefined): AllGoalsView {
  const requested = Array.isArray(param) ? param[0] : param;
  return requested && isAllGoalsView(requested) ? requested : (DEFAULT_GOAL_VIEW as AllGoalsView);
}

/** How many things on you each goal holds, keyed by goal id, from the Today list. */
export function onYouByGoal(items: readonly { goalId: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!item.goalId) continue;
    counts.set(item.goalId, (counts.get(item.goalId) ?? 0) + 1);
  }
  return counts;
}

/** A goal still to be worked: not archived, not finished, not dropped. */
function isOpen(goal: Goal): boolean {
  return !goal.archivedAt && goal.status !== 'done' && goal.status !== 'dropped';
}

export function goalInView(
  goal: Goal,
  view: AllGoalsView,
  onYou: ReadonlyMap<string, number>,
): boolean {
  switch (view) {
    case 'all':
      return true;
    case 'open':
      return isOpen(goal);
    case 'you':
      return isOpen(goal) && (goal.status === 'proposed' || (onYou.get(goal.id) ?? 0) > 0);
  }
}

/** An area as a view shows it, with how many live goals it holds in all. */
export type AreaInView = AreaWithGoals & { liveCount: number };

/**
 * The areas narrowed to a view. An area whose goals all fall out of the view
 * is hidden rather than drawn empty. One with no goals at all stays in Open
 * and Everything, where its goals are added, and is hidden from On you.
 * Archived goals come after the live ones in their area.
 */
export function areasInView(
  areas: readonly AreaWithGoals[],
  view: AllGoalsView,
  onYou: ReadonlyMap<string, number>,
): AreaInView[] {
  return areas.flatMap((area) => {
    const shown = area.goals.filter((goal) => goalInView(goal, view, onYou));
    const goals = [
      ...shown.filter((goal) => !goal.archivedAt),
      ...shown.filter((goal) => goal.archivedAt),
    ];
    const liveCount = area.goals.filter((goal) => !goal.archivedAt).length;
    const hide = goals.length === 0 && (view === 'you' || area.goals.length > 0);
    return hide ? [] : [{ ...area, goals, liveCount }];
  });
}

/** How many goals each view holds, for the chips. */
export function countAllGoalsView(
  areas: readonly AreaWithGoals[],
  view: AllGoalsView,
  onYou: ReadonlyMap<string, number>,
): number {
  return areas.reduce(
    (sum, area) => sum + area.goals.filter((goal) => goalInView(goal, view, onYou)).length,
    0,
  );
}
