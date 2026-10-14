/**
 * Later on the Goals home and Inbox: put something on you aside until a later
 * day, chosen from the menu every Later uses (components/inbox/snooze-menu.tsx).
 *
 * A step that is set aside gets a start date, the same `starts_on` the goal
 * page's Starts field writes (migrations-goals/0043). Everything that picks
 * what is next already skips a step whose start date is ahead (`waitsUntil`),
 * so the step leaves Up next and the folded list today, and comes back on its
 * own on the day chosen. Nothing new is stored, and the goal page shows the
 * date on the step, so a set-aside step is never lost.
 *
 * A step due before the day chosen has its due date moved to that day as
 * well, since a step cannot start after it is due; the toast says so.
 *
 * Only the kinds that are a step can be set aside. The others already have a
 * way to say no (a suggestion's Not for me, a goal's Keep it open) or are
 * about the world rather than a plan (a flag).
 *
 * Pure, so the dates are tested without a database or a clock. The write is
 * setAsideAction in app/goals/home-actions.ts.
 */
import type { TodayKind } from '@/lib/goals/today';
import { SNOOZE_CHOICES, snoozeDay, type SnoozeChoice } from '@/lib/core/snooze-days';

/** Later's named days (lib/core/snooze-days.ts), the same everywhere. */
export type SetAsideChoice = SnoozeChoice;
export const SET_ASIDE_CHOICES: readonly SetAsideChoice[] = SNOOZE_CHOICES;

/** The Today kinds whose id is a step, which is what a start date goes on. */
const STEP_KINDS: ReadonlySet<TodayKind> = new Set(['step', 'question', 'ask', 'rhythm']);

export function canSetAside(kind: TodayKind): boolean {
  return STEP_KINDS.has(kind);
}

/**
 * The day a named choice means, from `today` (YYYY-MM-DD in the account's
 * zone), as snoozeDay reads it: tomorrow, the coming Saturday, the coming
 * Monday, or the first of next month.
 */
export function setAsideOn(choice: SetAsideChoice, today: string): string {
  return snoozeDay(choice, today) as string;
}

/**
 * The fields to write: the start date, and the due date too when it falls
 * before the start. `dueMoved` says whether it did, for the toast.
 */
export function setAsideFields(
  step: { dueOn: string | null },
  on: string,
): { starts_on: string; due_on?: string; dueMoved: boolean } {
  if (step.dueOn && step.dueOn < on) return { starts_on: on, due_on: on, dueMoved: true };
  return { starts_on: on, dueMoved: false };
}
