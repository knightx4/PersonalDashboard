import { addDays } from '@/lib/todo/tasks/model';
import { whenTime } from '@/lib/core/when';

/**
 * One schedule for a day or a range of days (plan #3027): what the person
 * has on, gathered from every place the app keeps it.
 *
 * On 6 November 2026 a mentor said the weekend was wide open while a party
 * from the Partiful calendar sat on Saturday evening, because the answer read
 * only the person's own events. Every answer about what is on a day reads
 * this instead, so a calendar, a booking email or an interview round cannot
 * be left out by whichever reader forgot it.
 *
 * Two kinds of entry. A booked one holds a place in the day: an event of
 * theirs, one from a calendar they subscribe to, an appointment read from a
 * booking email, an interview. A due one is something to do by that day: a
 * todo, a job reminder, a bill, a return window closing, a goal step sent to
 * Todo. Only booked entries are matched against each other, since the same
 * dinner is often both on a calendar and in a confirmation email, and a todo
 * is never the same thing as a meeting.
 *
 * PURE. The loader (load.ts) reads the rows; everything here is a question
 * of days, words and clocks, tested with rows written by hand.
 */

export type ScheduleSource =
  | 'own_event'
  | 'feed_event'
  | 'appointment'
  | 'interview'
  | 'todo'
  | 'agenda';

export type ScheduleKind = 'booked' | 'due';

/** Another source's copy of the same thing, folded into an entry. */
export interface ScheduleCopy {
  source: ScheduleSource;
  /** Where it came from, in words: "Partiful calendar", "Booking email". */
  from: string;
  ref: string;
  title: string;
  startsAt: string | null;
}

export interface ScheduleEntry {
  /** Unique across the schedule. */
  key: string;
  source: ScheduleSource;
  kind: ScheduleKind;
  /** Where it came from, in words: "Your calendar", "Partiful calendar", "Booking email". */
  from: string;
  /** The row, as `schema.table:id` (lib/core/refs.ts). */
  ref: string;
  title: string;
  /** The first day it is on, YYYY-MM-DD in the reader's zone. */
  day: string;
  /** The last day it is on; equal to `day` for one day. */
  lastDay: string;
  /** An instant, when it has a clock. Null for an all-day or a day-only entry. */
  startsAt: string | null;
  endsAt: string | null;
  allDay: boolean;
  location: string | null;
  /** Anything else worth a word: the provider, the round, the bill's amount. */
  detail: string | null;
  /** Where it opens in the app. */
  href: string;
  /** Other sources holding the same thing at the same time, folded in here. */
  alsoIn: ScheduleCopy[];
  /**
   * Other sources holding what looks like the same thing at a different
   * time. Both are kept and both name the other: which time is right is a
   * question for the person, never a pick.
   */
  conflicts: ScheduleCopy[];
}

/** The most days one schedule covers. A month is the longest question asked of one. */
export const SCHEDULE_MAX_DAYS = 31;

/** Starts this close are one thing told twice, not two. */
export const SAME_TIME_MS = 15 * 60 * 1000;

/**
 * Which copy of a duplicate leads, best first. An interview carries the role
 * and its prep, a booking email the reservation itself, an event of theirs
 * what they wrote; a subscribed calendar's copy is the one least theirs.
 */
const LEAD_ORDER: ScheduleSource[] = ['interview', 'appointment', 'own_event', 'feed_event', 'todo', 'agenda'];

/**
 * Words that say what kind of thing it is rather than which one, so two
 * entries sharing only these are not the same thing: "Dinner with Sam" and
 * "Dinner at Lilia" are two dinners.
 */
const GENERIC = new Set([
  'the', 'and', 'with', 'for', 'from', 'at', 'on', 'in', 'of', 'to', 'a', 'an', 'my', 'our', 'your',
  'dinner', 'lunch', 'breakfast', 'brunch', 'drinks', 'coffee', 'meeting', 'meet', 'call', 'chat',
  'interview', 'screen', 'round', 'party', 'event', 'appointment', 'reservation', 'booking', 'booked',
  'table', 'session', 'catch', 'up', 'sync', 'video', 'phone', 'zoom', 'google', 'meet', 'link',
  'see', 'attached', 'partiful', 'calendar', 'invite', 'invitation', 'confirmed', 'confirmation',
  'http', 'https', 'www', 'com', 'pwd', 'apt', 'ave', 'street', 'st', 'road', 'rd', 'nyc', 'ny', 'nj', 'new', 'york', 'city', 'pm', 'am',
]);

/** The words that say which thing this is, lowercased and without a plural s. */
export function distinctiveWords(...texts: (string | null | undefined)[]): Set<string> {
  const words = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const raw of text.toLowerCase().normalize('NFKD').split(/[^a-z0-9]+/)) {
      if (raw.length < 3 || /^\d+$/.test(raw)) continue;
      const word = raw.length > 4 && raw.endsWith('s') ? raw.slice(0, -1) : raw;
      if (!GENERIC.has(word) && !GENERIC.has(raw)) words.add(word);
    }
  }
  return words;
}

/**
 * How much of the shorter set of words the other holds, 0 to 1. Measured
 * against the shorter, since one copy is often a few words of the other:
 * "Interview with Tabs" is all of itself inside "Tabs · Implementation Lead".
 */
function overlap(a: Set<string>, b: Set<string>): number {
  const shorter = a.size <= b.size ? a : b;
  const longer = shorter === a ? b : a;
  if (shorter.size === 0) return 0;
  let shared = 0;
  for (const word of shorter) if (longer.has(word)) shared += 1;
  return shared / shorter.size;
}

/** At least this much of the shorter name, or of the shorter place, is shared. */
export const ALIKE = 0.5;

/**
 * Whether two booked entries read as the same thing, by their names or, when
 * both give one, by their places. Half the shorter name has to be shared, so
 * two interviews for "Implementation" roles at different companies on one
 * day are two interviews.
 */
export function looksAlike(a: ScheduleEntry, b: ScheduleEntry): boolean {
  if (overlap(distinctiveWords(a.title), distinctiveWords(b.title)) >= ALIKE) return true;
  if (!a.location || !b.location) return false;
  return overlap(distinctiveWords(a.location), distinctiveWords(b.location)) >= ALIKE;
}

/** Whether two entries share a day, a span overlapping the other's. */
function shareADay(a: ScheduleEntry, b: ScheduleEntry): boolean {
  return a.day <= b.lastDay && b.day <= a.lastDay;
}

/** Same time: both on the clock within SAME_TIME_MS, or one without a clock at all. */
function sameTime(a: ScheduleEntry, b: ScheduleEntry): boolean {
  if (!a.startsAt || !b.startsAt) return true;
  return Math.abs(Date.parse(a.startsAt) - Date.parse(b.startsAt)) <= SAME_TIME_MS;
}

function copyOf(entry: ScheduleEntry): ScheduleCopy {
  return { source: entry.source, from: entry.from, ref: entry.ref, title: entry.title, startsAt: entry.startsAt };
}

function rank(entry: ScheduleEntry): number {
  return LEAD_ORDER.indexOf(entry.source);
}

/**
 * The entries with each thing told once.
 *
 * First, booked entries from different sources that look alike, share a day
 * and agree on the time become one, led by the best source (LEAD_ORDER), the
 * others kept in `alsoIn`. An entry with a clock leads one without, whatever
 * its source, since it says more. Then, among what is left on its own, two
 * from different sources that look alike on the same day at different times
 * are both kept and each names the other in `conflicts`. An entry already
 * matched at its own time is not put in a conflict: a second, later round
 * with the same company is a second round.
 */
export function foldSchedule(entries: readonly ScheduleEntry[]): ScheduleEntry[] {
  const booked = entries
    .filter((entry) => entry.kind === 'booked')
    .map((entry) => ({ ...entry, alsoIn: [...entry.alsoIn], conflicts: [...entry.conflicts] }))
    .sort((a, b) => Number(!a.startsAt) - Number(!b.startsAt) || rank(a) - rank(b));
  const due = entries.filter((entry) => entry.kind === 'due');

  const leads: ScheduleEntry[] = [];
  for (const entry of booked) {
    const lead = leads.find(
      (other) =>
        other.source !== entry.source &&
        !other.alsoIn.some((copy) => copy.source === entry.source) &&
        shareADay(other, entry) &&
        sameTime(other, entry) &&
        looksAlike(other, entry),
    );
    if (lead) {
      lead.alsoIn.push(copyOf(entry));
      if (!lead.location && entry.location) lead.location = entry.location;
      if (!lead.endsAt && entry.endsAt) lead.endsAt = entry.endsAt;
    } else {
      leads.push(entry);
    }
  }

  const alone = leads.filter((entry) => entry.alsoIn.length === 0 && entry.startsAt);
  for (let i = 0; i < alone.length; i++) {
    for (let j = i + 1; j < alone.length; j++) {
      const a = alone[i];
      const b = alone[j];
      if (a.source === b.source || !shareADay(a, b) || sameTime(a, b) || !looksAlike(a, b)) continue;
      a.conflicts.push(copyOf(b));
      b.conflicts.push(copyOf(a));
    }
  }

  return [...leads, ...due].sort(compareEntries);
}

/** By day, all-day before timed, then by the clock, then by title. */
export function compareEntries(a: ScheduleEntry, b: ScheduleEntry): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  const aTimed = a.startsAt ? 1 : 0;
  const bTimed = b.startsAt ? 1 : 0;
  if (aTimed !== bTimed) return aTimed - bTimed;
  if (a.startsAt && b.startsAt && a.startsAt !== b.startsAt) return a.startsAt < b.startsAt ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === 'booked' ? -1 : 1;
  return a.title.localeCompare(b.title);
}

export interface ScheduleRange {
  from: string;
  to: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The range asked for, made safe: `to` defaults to `from`, a reversed pair is
 * put the right way round, and a range longer than SCHEDULE_MAX_DAYS is cut
 * to that many days. Null when `from` is not a day.
 */
export function scheduleRange(from: string, to?: string | null): (ScheduleRange & { cut: boolean }) | null {
  if (!DAY.test(from)) return null;
  let first = from;
  let last = to && DAY.test(to) ? to : from;
  if (last < first) [first, last] = [last, first];
  const limit = addDays(first, SCHEDULE_MAX_DAYS - 1);
  return last > limit ? { from: first, to: limit, cut: true } : { from: first, to: last, cut: false };
}

/** Every day from `from` to `to`, inclusive. */
export function daysOf(range: ScheduleRange): string[] {
  const days: string[] = [];
  for (let day = range.from; day <= range.to; day = addDays(day, 1)) days.push(day);
  return days;
}

/**
 * The entries on one day: those that start on it, and a span that started
 * before it and is still running.
 */
export function entriesOn(entries: readonly ScheduleEntry[], day: string): ScheduleEntry[] {
  return entries.filter((entry) => entry.day <= day && entry.lastDay >= day);
}

/** "7:30 pm", or "All day", for one entry in the reader's zone. */
export function clockOf(entry: Pick<ScheduleEntry, 'startsAt'>, timezone: string): string {
  return entry.startsAt ? whenTime(entry.startsAt, { timeZone: timezone }) : 'All day';
}

/**
 * The question a conflict asks, in words the person can answer: "Numeric ·
 * Implementation is at 6:00 am on the interview and 11:00 am on the Google
 * calendar: which is right?"
 */
export function conflictQuestion(entry: ScheduleEntry, timezone: string): string | null {
  if (entry.conflicts.length === 0) return null;
  const others = entry.conflicts
    .map((copy) => `${copy.startsAt ? whenTime(copy.startsAt, { timeZone: timezone }) : 'no time'} in ${copy.from}`)
    .join(' and ');
  return `${entry.title} is at ${clockOf(entry, timezone)} in ${entry.from} and ${others}: which is right?`;
}
