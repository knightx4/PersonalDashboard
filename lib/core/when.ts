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

// -- zones, fixed dates, months and ranges (plan #1957.5, #1957.6) -----------
//
// What the other workspaces needed and the functions above do not give. The
// zone helpers are arithmetic rather than words: they read an instant's parts
// on the 24-hour clock, for a time input's value, a day's key, a greeting's
// hour or a zone's offset. `whenDate`, `whenMonth`, `whenRange` and
// `whenWeekday` write a date that does not move with today: a byline, a
// heading over a calendar, a week, a month in a list.

/** The zone the browser runs in, or null where the platform will not say. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** The zone's own spelling ("europe/london" reads "Europe/London"), or null when the platform does not know it. */
export function canonicalTimeZone(zone: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: zone }).resolvedOptions().timeZone ?? zone;
  } catch {
    return null;
  }
}

/** Whether the platform can place a moment in this zone. */
export function isTimeZone(zone: string): boolean {
  return canonicalTimeZone(zone) !== null;
}

export interface ZoneParts {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  /** 0 to 23. */
  hour: number;
  minute: number;
  second: number;
  /** 0 is Sunday, as `Date.getDay` counts. */
  weekday: number;
}

/** The calendar and the 24-hour clock an instant reads as in a zone. */
export function zoneParts(at: WhenInput, timeZone: string): ZoneParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at instanceof Date ? at : new Date(at));
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  return {
    year,
    month,
    day,
    hour: pick('hour') % 24,
    minute: pick('minute'),
    second: pick('second'),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/**
 * The day an instant falls on in a zone, as `YYYY-MM-DD`: a date input's
 * value and a day's key. A bare date names its own day and comes back as it is.
 */
export function zoneDay(at: WhenInput, timeZone: string): string {
  const c = civilDay(at, timeZone);
  return `${c.year}-${pad2(c.month)}-${pad2(c.day)}`;
}

/** The clock an instant reads in a zone, as `HH:MM` on the 24-hour clock: a time input's value. */
export function zoneClock(at: WhenInput, timeZone: string): string {
  const p = zoneParts(at, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

/** How far ahead of UTC a zone is at an instant, in milliseconds (to the whole second). */
export function zoneOffset(at: WhenInput, timeZone: string): number {
  const instant = (at instanceof Date ? at : new Date(at)).getTime();
  const p = zoneParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/** A zone's offset as a picker hints it: "GMT", "GMT-4", "GMT+5:30". */
export function zoneOffsetLabel(timeZone: string, at: WhenInput = Date.now()): string {
  const minutes = Math.round(zoneOffset(at, timeZone) / MINUTE);
  if (minutes === 0) return 'GMT';
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  const rest = abs % 60;
  return `GMT${sign}${Math.floor(abs / 60)}${rest ? `:${pad2(rest)}` : ''}`;
}

/** The zone's short name at that moment: "EDT", "BST", or "GMT+2" where it has none. */
export function whenZoneName(at: WhenInput, options: Pick<WhenOptions, 'timeZone'>): string {
  return (
    new Intl.DateTimeFormat('en-US', { timeZone: options.timeZone, timeZoneName: 'short' })
      .formatToParts(at instanceof Date ? at : new Date(at))
      .find((p) => p.type === 'timeZoneName')?.value ?? options.timeZone
  );
}

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

export interface WhenDateOptions {
  /** The zone an instant is read in. A bare `YYYY-MM-DD` names its own day and ignores it. */
  timeZone: string;
  /** "Oct", the default, or "October". */
  month?: 'short' | 'long';
  /** The weekday before the date: "Wed 14 Oct", "Wednesday 14 October". None by default. */
  weekday?: 'short' | 'long';
  /** The year after it: always (the default), never, or only when it is not this year. */
  year?: 'always' | 'never' | 'auto';
  /** The moment "this year" is measured from, for `year: 'auto'`. */
  now?: WhenInput;
}

function dateText(c: Civil, month: 'short' | 'long', withYear: boolean): string {
  const name = (month === 'long' ? MONTHS_LONG : MONTHS)[c.month - 1];
  return withYear ? `${c.day} ${name} ${c.year}` : `${c.day} ${name}`;
}

/**
 * A date that does not move with today, never Today or a weekday in its
 * place: "14 Oct 2026", "14 October 2026", "Wednesday 14 October". For a
 * byline, a heading over a day, or a date read as a record rather than as how
 * near it is; `whenDay` is for the rest.
 */
export function whenDate(at: WhenInput, options: WhenDateOptions): string {
  const { timeZone, month = 'short', weekday, year = 'always', now = Date.now() } = options;
  const day = civilDay(at, timeZone);
  const withYear = year === 'always' || (year === 'auto' && day.year !== civilDay(now, timeZone).year);
  const text = dateText(day, month, withYear);
  if (!weekday) return text;
  const dayName = weekdayOf(day);
  return `${weekday === 'short' ? dayName.slice(0, 3) : dayName} ${text}`;
}

/** A month: "October 2026", "Oct 2026", or the name alone with `year: false`. Takes a bare `YYYY-MM` too. */
export function whenMonth(
  at: WhenInput,
  options: { timeZone: string; month?: 'short' | 'long'; year?: boolean },
): string {
  const { timeZone, month = 'long', year = true } = options;
  const civil =
    typeof at === 'string' && /^\d{4}-\d{2}$/.test(at)
      ? { year: Number(at.slice(0, 4)), month: Number(at.slice(5, 7)), day: 1 }
      : civilDay(at, timeZone);
  const name = month === 'long' ? MONTHS_LONG[civil.month - 1] : MONTHS[civil.month - 1];
  return year ? `${name} ${civil.year}` : name;
}

/**
 * Two days as one span, each part said once: "1 – 7 Sep 2026", "31 Aug – 6
 * Sep 2026", "31 Dec 2025 – 6 Jan 2026", and a single day as that day. The
 * year follows `whenDate`'s rule, except that `auto` writes both years when
 * the span crosses one; `never` leaves them off even then: "31 Dec – 6 Jan".
 */
export function whenRange(from: WhenInput, to: WhenInput, options: Omit<WhenDateOptions, 'weekday'>): string {
  const { timeZone, month = 'short', year = 'always', now = Date.now() } = options;
  const a = civilDay(from, timeZone);
  const b = civilDay(to, timeZone);
  const sameYear = a.year === b.year;
  const withYear =
    year === 'always' || (year === 'auto' && (!sameYear || b.year !== civilDay(now, timeZone).year));
  const end = dateText(b, month, withYear);
  if (!sameYear) return `${dateText(a, month, withYear)} – ${end}`;
  if (a.month !== b.month) return `${dateText(a, month, false)} – ${end}`;
  if (a.day === b.day) return end;
  return `${a.day} – ${end}`;
}

/** A weekday's name: "Wednesday", or "Wed" with `style: 'short'`. */
export function whenWeekday(at: WhenInput, options: { timeZone: string; style?: 'short' | 'long' }): string {
  const name = weekdayOf(civilDay(at, options.timeZone));
  return options.style === 'short' ? name.slice(0, 3) : name;
}
