import { DUE_SOON_DAYS } from '@/lib/returns/deadline';

/**
 * How a deadline is doing, in four states.
 *
 * The two thresholds already existed in two places -- DUE_SOON_DAYS for the
 * "Due soon" filter, and a `daysLeft <= 7` test inside the return fuse -- so
 * the bar, the words beside it and the filter could drift apart. They are here
 * once now, and everything that draws a deadline reads them from here.
 *
 * The window is a required argument and not a convenience: a health state is a
 * claim about how much of a window is gone, so a deadline with no window to
 * divide by gets no state at all rather than a guess (law 3).
 */
export type HealthState = 'on-track' | 'at-risk' | 'closing' | 'overdue';

/** Past due. */
const OVERDUE = 0;
/** The last week, which is when a return has to actually be posted. */
export const CLOSING_DAYS = 7;

/**
 * The state a deadline is in, or null when there is nothing to divide by.
 *
 * @param daysLeft Calendar days from today to the deadline; negative is past.
 * @param windowDays The full length of the window the deadline came from.
 */
export function deadlineHealth(
  daysLeft: number | null,
  windowDays: number | null,
): HealthState | null {
  if (daysLeft === null || windowDays === null || windowDays <= 0) return null;
  if (daysLeft < OVERDUE) return 'overdue';
  if (daysLeft <= CLOSING_DAYS) return 'closing';
  if (daysLeft <= DUE_SOON_DAYS) return 'at-risk';
  return 'on-track';
}

/**
 * The words and the ink for each state.
 *
 * Colour follows law 4. Amber is caution and red is danger, both of which are
 * true of a window about to shut or already shut. There is no meaning that is
 * true of the other two, so they are ink and nothing else: ghost while there is
 * plenty of window left, full ink once more than half of it is gone.
 */
export const HEALTH_STATES: Record<HealthState, { label: string; fill: string }> = {
  'on-track': { label: 'On track', fill: 'bg-ink-ghost' },
  'at-risk': { label: 'At risk', fill: 'bg-ink' },
  closing: { label: 'Closing', fill: 'bg-caution' },
  overdue: { label: 'Overdue', fill: 'bg-danger' },
};

/** Reading order, worst last, for anything that lists all four. */
export const HEALTH_ORDER: readonly HealthState[] = [
  'on-track',
  'at-risk',
  'closing',
  'overdue',
];
