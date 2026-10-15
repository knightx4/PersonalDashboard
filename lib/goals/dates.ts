import { safeTimeZone } from '@/lib/core/timezone';
import { formatClock, whenDate } from '@/lib/core/when';

/**
 * Dates as the Goals pages print them: "3 Oct", "3 Oct 2026", "Thu 1 Oct,
 * 18:30".
 *
 * One fixed locale, the one the step tree already used, so the server and
 * the browser print the same text and the page hydrates cleanly. Before this
 * the home and the number section passed `undefined`, which is the locale of
 * whichever machine renders: the home printed "Oct 3" from the server while
 * the suggestions under it, a client component, printed "1 Oct" in the
 * browser, on the same screen.
 *
 * A calendar date (YYYY-MM-DD) is read and printed in UTC, so no zone can
 * move it a day. An instant is printed in the account's zone.
 */

/** A calendar date, "3 Oct", or "3 Oct 2026" with the year. */
export function formatDay(isoDate: string, withYear = false): string {
  return whenDate(isoDate, { timeZone: 'UTC', year: withYear ? 'always' : 'never' });
}

/** A calendar date with its weekday, "Thu 1 Oct". */
export function formatWeekday(isoDate: string): string {
  return whenDate(isoDate, { timeZone: 'UTC', weekday: 'short', year: 'never' });
}

/** An instant in the account's zone, "Thu 1 Oct, 18:30". */
export function formatInstant(
  iso: string,
  timeZone: string,
  { weekday = true }: { weekday?: boolean } = {},
): string {
  return formatClock(iso, {
    ...(weekday ? { weekday: 'short' } : {}),
    day: 'numeric',
    month: 'short',
    timeZone: safeTimeZone(timeZone),
  });
}
