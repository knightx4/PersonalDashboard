/**
 * Not now on the Goals home: put something on you aside until a later day.
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

export type SetAsideChoice = 'tomorrow' | 'weekend' | 'next_week' | 'next_month';

export const SET_ASIDE_CHOICES: readonly SetAsideChoice[] = [
  'tomorrow',
  'weekend',
  'next_week',
  'next_month',
];

export const SET_ASIDE_LABELS: Record<SetAsideChoice, string> = {
  tomorrow: 'Tomorrow',
  weekend: 'This weekend',
  next_week: 'Next week',
  next_month: 'Next month',
};

/** The Today kinds whose id is a step, which is what a start date goes on. */
const STEP_KINDS: ReadonlySet<TodayKind> = new Set(['step', 'question', 'ask', 'rhythm']);

export function canSetAside(kind: TodayKind): boolean {
  return STEP_KINDS.has(kind);
}

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 0 for Sunday through 6 for Saturday. */
function weekday(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/**
 * The day a choice means, from `today` (YYYY-MM-DD in the account's zone):
 *
 * - tomorrow: the next day
 * - this weekend: the coming Saturday, a week on if today is Saturday
 * - next week: the coming Monday, a week on if today is Monday
 * - next month: the first of next month
 */
export function setAsideOn(choice: SetAsideChoice, today: string): string {
  switch (choice) {
    case 'tomorrow':
      return addDays(today, 1);
    case 'weekend': {
      const until = (6 - weekday(today) + 7) % 7;
      return addDays(today, until === 0 ? 7 : until);
    }
    case 'next_week': {
      const until = (1 - weekday(today) + 7) % 7;
      return addDays(today, until === 0 ? 7 : until);
    }
    case 'next_month': {
      const [year, month] = today.split('-').map(Number);
      const next = new Date(Date.UTC(year, month, 1));
      return next.toISOString().slice(0, 10);
    }
  }
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
