/**
 * The week's focus (docs/GOALS-SPEC.md, "The week's focus"; goals 0070).
 *
 * Each week the person picks the two or three goals they are pushing. While
 * any open goal has focus, only those goals put their next step on Todo, and
 * Dash works their steps before anyone else's. When none has it, every goal
 * counts, as before focus existed.
 *
 * An errand is the exception: it has a date it is due by, so one due within
 * a week counts as in focus whether or not it was picked. Errands are not
 * offered on the Plan your week card for that reason.
 *
 * Pure, so the rules are tested without a database. The reads and writes are
 * in lib/goals/focus-store.ts.
 */
import { startOfWeek } from '@/lib/todo/calendar/range';
import { addDays } from '@/lib/todo/tasks/model';
import type { Goal } from '@/lib/goals/tree';

/**
 * The most focus goals the card suggests. Picking more is allowed; the card
 * says that three is the most that tends to work.
 */
export const FOCUS_SUGGESTED = 3;

/** How many days ahead an errand's due date pulls it into focus. */
export const ERRAND_FOCUS_DAYS = 7;

/** A goal the Plan your week card offers as a chip. */
export type PlanWeekGoal = { id: string; title: string; focus: boolean };

/**
 * Last week in numbers: steps of the person's closed in it, and the rhythm
 * periods that ended in it, kept or missed.
 */
export type WeekRecap = { stepsClosed: number; rhythmsKept: number; rhythmsMissed: number };

/** The search param that reopens Plan your week on the home: `?plan=1`. */
export const PLAN_PARAM = 'plan';

type FocusGoal = Pick<Goal, 'id' | 'status' | 'focus' | 'errand' | 'dueOn'>;

/** Whether the person has chosen a focus: some open goal has it. */
export function focusActive(goals: readonly FocusGoal[]): boolean {
  return goals.some((goal) => goal.status === 'open' && goal.focus === true);
}

/** Whether an errand is due within a week of today, or is already late. */
export function errandDueSoon(goal: FocusGoal, today: string): boolean {
  return Boolean(goal.errand && goal.dueOn && goal.dueOn <= addDays(today, ERRAND_FOCUS_DAYS));
}

/**
 * Whether a goal counts as in focus this week. Every goal does while none
 * has focus. Otherwise a goal with focus does, and so does an errand due
 * within a week (when `today` is given).
 */
export function inFocus(goal: FocusGoal, goals: readonly FocusGoal[], today?: string): boolean {
  if (!focusActive(goals)) return true;
  if (goal.focus) return true;
  return today !== undefined && errandDueSoon(goal, today);
}

/** The Monday of the week holding `today`, which is what visits.planned_week stores. */
export function weekOf(today: string): string {
  return startOfWeek(today);
}

/** The Monday of the week before the one holding `today`. */
export function lastWeekOf(today: string): string {
  return addDays(weekOf(today), -7);
}

/**
 * Whether the home should ask for this week's plan: the person has never
 * planned, or last planned a week before this one.
 */
export function needsPlanning(plannedWeek: string | null, today: string): boolean {
  return plannedWeek === null || plannedWeek < weekOf(today);
}

/**
 * The goals the Plan your week card offers: open goals that are not errands,
 * since an errand comes through by its date.
 */
export function plannable<T extends FocusGoal>(goals: readonly T[]): T[] {
  return goals.filter((goal) => goal.status === 'open' && !goal.errand);
}

/** Whether the person picked more than the card suggests. */
export function overSuggested(count: number): boolean {
  return count > FOCUS_SUGGESTED;
}
