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
import { toGoalActivity, type AreaWithGoals, type Goal } from '@/lib/goals/tree';

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

/**
 * Which kind of goal the list shows (plan #2503.4): active goals only,
 * passive ones only, or both. A second narrowing beside the view, kept in
 * `?kind=`, with both as the default so the bare address shows every goal
 * the view holds.
 */
export type GoalKindFilter = 'both' | 'active' | 'passive';

export const GOAL_KIND_FILTERS: readonly GoalKindFilter[] = ['both', 'active', 'passive'];

export const GOAL_KIND_LABEL: Record<GoalKindFilter, string> = {
  both: 'Both',
  active: 'Active',
  passive: 'Passive',
};

/** The kind a `?kind=` parameter asks for, or both when it names neither. */
export function goalKindOf(param: string | string[] | undefined): GoalKindFilter {
  const requested = Array.isArray(param) ? param[0] : param;
  return requested === 'active' || requested === 'passive' ? requested : 'both';
}

/** The address of a view and kind on a list page, leaving the defaults out. */
export function allGoalsHref(
  path: string,
  view: AllGoalsView,
  kind: GoalKindFilter = 'both',
): string {
  const params = new URLSearchParams();
  if (view !== DEFAULT_GOAL_VIEW) params.set('view', view);
  if (kind !== 'both') params.set('kind', kind);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** Whether a goal is of the kind asked for; a goal with no activity stored reads as active. */
export function goalOfKind(goal: Goal, kind: GoalKindFilter): boolean {
  return kind === 'both' || toGoalActivity(goal.activity) === kind;
}

/**
 * Where an area is: its own page (plan #1619), which lists its goals, the
 * goals Dash proposed for it and its rhythms with the editing All goals
 * offers. An area with no open goal shows nothing under Open, the default
 * view, so it is opened under Everything.
 */
export function areaHref(areaId: string, { open = true }: { open?: boolean } = {}): string {
  return `/goals/area/${areaId}${open ? '' : '?view=all'}`;
}

/** A step's own page (plan #1620), under the goal it belongs to. A sub-step's is the same. */
export function stepHref(goalId: string, stepId: string): string {
  return `/goals/${goalId}/s/${stepId}`;
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

/**
 * A goal still to be worked: not archived, parked, finished or dropped. A
 * parked goal waits under Everything until it is taken back up (plan #2097.1).
 */
function isOpen(goal: Goal): boolean {
  return (
    !goal.archivedAt &&
    goal.status !== 'done' &&
    goal.status !== 'dropped' &&
    goal.status !== 'parked'
  );
}

export function goalInView(
  goal: Goal,
  view: AllGoalsView,
  onYou: ReadonlyMap<string, number>,
  kind: GoalKindFilter = 'both',
): boolean {
  if (!goalOfKind(goal, kind)) return false;
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
  kind: GoalKindFilter = 'both',
): AreaInView[] {
  return areas.flatMap((area) => {
    const shown = areaInView(area, view, onYou, kind);
    // Narrowed to one kind, an area with none of that kind is hidden too.
    const hide =
      shown.goals.length === 0 && (view === 'you' || kind !== 'both' || area.goals.length > 0);
    return hide ? [] : [shown];
  });
}

/**
 * One area narrowed to a view, kept even when none of its goals is in it:
 * the area's own page draws it whatever the view leaves.
 */
export function areaInView(
  area: AreaWithGoals,
  view: AllGoalsView,
  onYou: ReadonlyMap<string, number>,
  kind: GoalKindFilter = 'both',
): AreaInView {
  const shown = area.goals.filter((goal) => goalInView(goal, view, onYou, kind));
  const goals = [
    ...shown.filter((goal) => !goal.archivedAt),
    ...shown.filter((goal) => goal.archivedAt),
  ];
  const liveCount = area.goals.filter((goal) => !goal.archivedAt).length;
  return { ...area, goals, liveCount };
}

/** How many goals each view holds, for the chips. */
export function countAllGoalsView(
  areas: readonly AreaWithGoals[],
  view: AllGoalsView,
  onYou: ReadonlyMap<string, number>,
  kind: GoalKindFilter = 'both',
): number {
  return areas.reduce(
    (sum, area) => sum + area.goals.filter((goal) => goalInView(goal, view, onYou, kind)).length,
    0,
  );
}
