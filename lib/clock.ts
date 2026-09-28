/**
 * Times as the app shows them: on a twelve-hour clock with AM or PM, as
 * "3:05 PM" (note 8551ddea).
 *
 * Every formatter that puts a time in front of the person goes through here,
 * so no screen drifts back to the 24-hour clock that `en-GB` formats in by
 * default. The dates around the time keep the locale they were given: "28 Sept,
 * 3:05 PM" rather than switching to the American "Sept 28".
 *
 * Only for what is read. A time input's value, and the arithmetic that reads a
 * zone's hour, stay on `hourCycle: 'h23'`.
 */

type ClockOptions = Omit<Intl.DateTimeFormatOptions, 'hour' | 'hour12' | 'hourCycle' | 'timeStyle'>;

/** An instant with its time on the twelve-hour clock, plus whatever date parts `options` ask for. */
export function formatClock(
  at: Date | string | number,
  options: ClockOptions = {},
  locale: string | undefined = 'en-GB',
): string {
  const date = at instanceof Date ? at : new Date(at);
  return new Intl.DateTimeFormat(locale, {
    minute: '2-digit',
    ...options,
    hour: 'numeric',
    hourCycle: 'h12',
  })
    .formatToParts(date)
    .map((part) => (part.type === 'dayPeriod' ? part.value.toUpperCase() : part.value))
    .join('')
    // ICU versions differ on the space before AM and PM, narrow or not; one
    // no-break space keeps "3:05 PM" together and the same on server and client.
    .replace(/[\u202f\u00a0 ](AM|PM)/g, '\u00a0$1');
}

/** An hour of the day, 0 to 23, as a calendar's gutter labels it: "12 AM", "9 AM", "3 PM". */
export function hourLabel(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 === 0 ? 12 : hour % 12}\u00a0${period}`;
}
