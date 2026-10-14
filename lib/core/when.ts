/**
 * The one place a date or a time becomes words (docs/ONE-INTERFACE-SPEC.md,
 * Part 5, R6). Every function takes the account's timezone, the `timezone` of
 * `AccountSettings` (lib/core/account/settings.ts), as `timeZone`. The module
 * does not load it itself so that client components can import it; a server
 * component reads the settings once and passes the zone down.
 *
 * - `whenDay`   Today, Tomorrow, Yesterday; a weekday name within six days;
 *               "12 Oct" beyond that; the year only when it is not this year.
 * - `whenTime`  "3:05 PM": 12-hour, AM and PM, no seconds, no leading zero.
 * - `whenSpan`  "2 h 10 min", "3 days", or for a deadline "in 1d 1h". The mono
 *               face and tabular figures are the caller's.
 * - `whenAgo`   "3 min ago", "yesterday", then a day. For threads, the status
 *               line and Updates, where the moment matters more than the date.
 *
 * A time never shows beside a day the person gave no time for: `whenAt` writes
 * the time only when the value has one, and a bare `YYYY-MM-DD` has none.
 *
 * `formatClock` and `hourLabel` are what lib/clock.ts held (note 8551ddea):
 * times on a twelve-hour clock, so no screen drifts back to the 24-hour clock
 * that `en-GB` formats in by default. The dates around the time keep the locale
 * they were given: "28 Sept, 3:05 PM" rather than the American "Sept 28".
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
    .replace(/[   ](AM|PM)/g, ' $1');
}

/** An hour of the day, 0 to 23, as a calendar's gutter labels it: "12 AM", "9 AM", "3 PM". */
export function hourLabel(hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 === 0 ? 12 : hour % 12} ${period}`;
}

// -- days, times, spans ------------------------------------------------------

export type WhenInput = Date | string | number;

export interface WhenOptions {
  /** The account's timezone (`AccountSettings.timezone`). */
  timeZone: string;
  /** The moment "today" is measured from; the clock when left out. */
  now?: WhenInput;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** True when the value names a moment and not only a calendar day. */
export function hasTime(at: WhenInput): boolean {
  return !(typeof at === 'string' && DATE_ONLY.test(at));
}

interface Civil {
  year: number;
  month: number; // 1 to 12
  day: number;
}

/** The calendar day of an instant in a zone, or the day a bare date names. */
function civilDay(at: WhenInput, timeZone: string): Civil {
  if (typeof at === 'string') {
    const m = DATE_ONLY.exec(at);
    if (m) return { year: +m[1], month: +m[2], day: +m[3] };
  }
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(at instanceof Date ? at : new Date(at));
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

const dayNumber = (c: Civil) => Date.UTC(c.year, c.month - 1, c.day) / DAY;

/** Whole calendar days from today to the day of `at`: 1 is tomorrow, -1 yesterday. */
function daysFromToday(at: WhenInput, { timeZone, now = Date.now() }: WhenOptions): number {
  return dayNumber(civilDay(at, timeZone)) - dayNumber(civilDay(now, timeZone));
}

function weekdayOf(c: Civil): string {
  return WEEKDAYS[new Date(Date.UTC(c.year, c.month - 1, c.day)).getUTCDay()];
}

/** "Today", "Tomorrow", "Yesterday", "Friday" within six days, else "12 Oct" (and the year when not this year). */
export function whenDay(at: WhenInput, options: WhenOptions): string {
  const { timeZone, now = Date.now() } = options;
  const diff = daysFromToday(at, options);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const day = civilDay(at, timeZone);
  if (Math.abs(diff) <= 6) return weekdayOf(day);
  const text = `${day.day} ${MONTHS[day.month - 1]}`;
  return day.year === civilDay(now, timeZone).year ? text : `${text} ${day.year}`;
}

/** "3:05 PM" in the account's zone. */
export function whenTime(at: WhenInput, options: Pick<WhenOptions, 'timeZone'>): string {
  return formatClock(at, { timeZone: options.timeZone });
}

/** The day, and the time after it when the value has one: "Tomorrow, 3:05 PM", "12 Oct". */
export function whenAt(at: WhenInput, options: WhenOptions): string {
  const day = whenDay(at, options);
  return hasTime(at) ? `${day}, ${whenTime(at, options)}` : day;
}

/**
 * A length of time, in milliseconds. Long, the default: "45 min", "2 h 10 min",
 * "3 days". Deadline: "in 45m", "in 2h 10m", "in 1d 1h", and "1d 1h ago" once
 * it has passed. Under a minute reads "under 1 min" ("in under 1m").
 */
export function whenSpan(ms: number, options: { style?: 'long' | 'deadline' } = {}): string {
  const deadline = options.style === 'deadline';
  const abs = Math.abs(ms);
  const days = Math.floor(abs / DAY);
  const hours = Math.floor((abs % DAY) / HOUR);
  const minutes = Math.floor((abs % HOUR) / MINUTE);
  if (deadline) {
    let text: string;
    if (days > 0) text = hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    else if (hours > 0) text = minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    else text = minutes > 0 ? `${minutes}m` : 'under 1m';
    return ms < 0 ? `${text} ago` : `in ${text}`;
  }
  if (days > 0) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (hours > 0) return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  return minutes > 0 ? `${minutes} min` : 'under 1 min';
}

/**
 * How long ago, for threads, the status line and Updates: "just now", "3 min
 * ago", "2 h ago" the same day, "yesterday", then the weekday or the date as
 * `whenDay` writes it. A moment ahead of now reads as its day.
 */
export function whenAgo(at: WhenInput, options: WhenOptions): string {
  const { now = Date.now() } = options;
  const then = (at instanceof Date ? at : new Date(at)).getTime();
  const elapsed = new Date(now).getTime() - then;
  const diff = daysFromToday(at, options);
  if (hasTime(at) && elapsed >= 0 && diff === 0) {
    if (elapsed < MINUTE) return 'just now';
    if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
    return `${Math.floor(elapsed / HOUR)} h ago`;
  }
  if (diff === -1) return 'yesterday';
  return whenDay(at, options);
}

// -- calendar parts, dates kept as dates, ranges (plan #1957.5) --------------
//
// For the places a relative day would be wrong: a heading that has to keep its
// date, a range, a weekday on its own. And the zone arithmetic callers did with
// Intl by hand: the day key, the hour, the offset, the zone's short name.

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The calendar day in the zone as `YYYY-MM-DD`, for keys and date inputs. A bare date comes back as it is. */
export function whenDayKey(at: WhenInput, options: Pick<WhenOptions, 'timeZone'>): string {
  const c = civilDay(at, options.timeZone);
  return `${c.year}-${pad2(c.month)}-${pad2(c.day)}`;
}

/** The hour of the day in the zone, 0 to 23, for arithmetic such as a greeting. */
export function whenHour(at: WhenInput, options: Pick<WhenOptions, 'timeZone'>): number {
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: options.timeZone, hour: '2-digit', hourCycle: 'h23' })
    .formatToParts(at instanceof Date ? at : new Date(at))
    .find((p) => p.type === 'hour')?.value;
  return Number(hour) % 24;
}

/** "Monday", or "Mon" with `style: 'short'`. */
export function whenWeekday(
  at: WhenInput,
  options: Pick<WhenOptions, 'timeZone'> & { style?: 'long' | 'short' },
): string {
  const name = weekdayOf(civilDay(at, options.timeZone));
  return options.style === 'short' ? name.slice(0, 3) : name;
}

export interface WhenDateOptions extends WhenOptions {
  /** A weekday before the date: "Sunday 4 October", "Sun 4 Oct". None by default. */
  weekday?: 'long' | 'short';
  /** "Oct", the default, or "October". */
  month?: 'short' | 'long';
  /**
   * `auto`, the default, writes the year only when it is not this year;
   * `never` leaves it off, for a line about the days just gone or coming.
   */
  year?: 'auto' | 'always' | 'never';
}

function dateText(c: Civil, month: 'short' | 'long', withYear: boolean): string {
  const name = (month === 'long' ? MONTHS_LONG : MONTHS)[c.month - 1];
  return withYear ? `${c.day} ${name} ${c.year}` : `${c.day} ${name}`;
}

/**
 * The date itself, never Today or a weekday in its place: "4 Oct", "4 October
 * 2025", "Sunday 4 October". For headings and lines that must keep their date.
 */
export function whenDate(at: WhenInput, options: WhenDateOptions): string {
  const { timeZone, now = Date.now(), weekday, month = 'short', year = 'auto' } = options;
  const day = civilDay(at, timeZone);
  const withYear = year === 'always' || (year === 'auto' && day.year !== civilDay(now, timeZone).year);
  const text = dateText(day, month, withYear);
  if (!weekday) return text;
  const name = weekdayOf(day);
  return `${weekday === 'short' ? name.slice(0, 3) : name} ${text}`;
}

/**
 * Two days as one range, saying each part once: "20 to 26 Sep", "28 Sep to
 * 4 Oct", "28 Dec 2025 to 3 Jan 2026". The year follows `whenDate`'s rule.
 */
export function whenRange(from: WhenInput, to: WhenInput, options: Omit<WhenDateOptions, 'weekday'>): string {
  const { timeZone, now = Date.now(), month = 'short', year = 'auto' } = options;
  const start = civilDay(from, timeZone);
  const end = civilDay(to, timeZone);
  const withYear =
    year === 'always' ||
    start.year !== end.year ||
    (year === 'auto' && end.year !== civilDay(now, timeZone).year);
  const last = dateText(end, month, withYear);
  if (start.year !== end.year) return `${dateText(start, month, true)} to ${last}`;
  if (start.month !== end.month) return `${dateText(start, month, false)} to ${last}`;
  if (start.day === end.day) return last;
  return `${start.day} to ${last}`;
}

/** The zone's short name at that moment: "EDT", "BST", or "GMT+2" where it has none. */
export function whenZoneName(at: WhenInput, options: Pick<WhenOptions, 'timeZone'>): string {
  return (
    new Intl.DateTimeFormat('en-US', { timeZone: options.timeZone, timeZoneName: 'short' })
      .formatToParts(at instanceof Date ? at : new Date(at))
      .find((p) => p.type === 'timeZoneName')?.value ?? options.timeZone
  );
}

/** How far the zone's wall clock is ahead of UTC at that moment, in milliseconds. */
export function whenOffset(at: WhenInput, options: Pick<WhenOptions, 'timeZone'>): number {
  const date = at instanceof Date ? at : new Date(at);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: options.timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return wall - (date.getTime() - date.getUTCMilliseconds());
}
