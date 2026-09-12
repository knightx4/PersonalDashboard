import ICAL from 'ical.js';

/**
 * Reading a published calendar file.
 *
 * Pure: text in, appointments out. No client, no clock of its own, no network
 * -- the fetching is next door in fetch.ts, and everything that can be wrong
 * here is a date question that a table test can ask.
 *
 * ical.js does the reading, which is what #276 settled. Repeating
 * appointments are most of a real calendar and the rules behind them have
 * thirty years of edge cases in them; this file is the fence around that
 * choice, and nothing outside lib/todo/feeds/ imports the library.
 */

/**
 * One occurrence of one appointment, in the shape todo.feed_events holds.
 *
 * The same date-or-instant split todo.events draws, for the same reason: a day
 * off must not move because the reader flew to Lisbon, and a 15:00 meeting
 * must. `endsOn` is the last day, inclusive -- a calendar file says the day
 * after, which is a different convention and is converted here rather than
 * anywhere a person might read it.
 */
export interface FeedEvent {
  /** The identifier the file gave it. Every occurrence of a repeat shares one. */
  uid: string;
  title: string;
  body: string | null;
  location: string | null;
  startsOn: string | null;
  endsOn: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

/** What an appointment with no SUMMARY is called, so it can be drawn at all. */
export const UNTITLED = 'Untitled';

/**
 * How many occurrences one repeating appointment may contribute.
 *
 * A daily stand-up with no end date is a legitimate file and an unbounded
 * loop; the window below is the real limit and this is the guard for a rule
 * that steps in minutes rather than days.
 */
const MAX_OCCURRENCES = 1000;

export interface Window {
  /** The first day to keep, YYYY-MM-DD. */
  from: string;
  /** The last day to keep, inclusive. */
  to: string;
}

/**
 * Every appointment in a calendar file that touches the window.
 *
 * Repeats are expanded into one occurrence per date, because the alternative
 * is a recurrence evaluator sitting between the table and every reader of it.
 * A date the file says was cancelled is left out, and an occurrence the file
 * edited replaces the one it stands in for -- both are ical.js's answer rather
 * than this file's.
 *
 * A component this cannot read is skipped rather than taking the whole
 * calendar down with it: one malformed appointment in a year of them should
 * cost that appointment, not the subscription.
 */
export function parseCalendar(text: string, window: Window): FeedEvent[] {
  const root = new ICAL.Component(ICAL.parse(text));
  registerTimezones(root);

  const masters = new Map<string, ICAL.Event>();
  const overrides: ICAL.Event[] = [];
  const singles: ICAL.Event[] = [];

  for (const component of root.getAllSubcomponents('vevent')) {
    let event: ICAL.Event;
    try {
      event = new ICAL.Event(component);
    } catch {
      continue;
    }

    if (isCancelled(component)) continue;

    if (event.isRecurrenceException()) {
      overrides.push(event);
      continue;
    }

    // Two appointments can share a uid across calendars, and a file can repeat
    // one. The first wins and the rest are read as appointments of their own,
    // rather than one silently replacing the other.
    if (event.uid && !masters.has(event.uid)) masters.set(event.uid, event);
    else singles.push(event);
  }

  for (const override of overrides) {
    const master = masters.get(override.uid);
    if (master) master.relateException(override);
    // An edited occurrence whose appointment is not in the file is still an
    // appointment, and dropping it would lose a meeting that was moved.
    else singles.push(override);
  }

  const events: FeedEvent[] = [];
  for (const event of [...masters.values(), ...singles]) {
    events.push(...occurrencesOf(event, window));
  }

  return events;
}

/**
 * The timezones the file carries inside it.
 *
 * A calendar file names zones like "Customized Time Zone" and then defines
 * them itself; without registering those definitions ical.js reads such a time
 * as floating, which is the same appointment an hour or two out. Only the
 * definitions the file brought -- the service is process-wide, so a name that
 * is already known is left alone.
 */
function registerTimezones(root: ICAL.Component): void {
  for (const component of root.getAllSubcomponents('vtimezone')) {
    const id = component.getFirstPropertyValue('tzid');
    if (typeof id !== 'string' || ICAL.TimezoneService.has(id)) continue;

    try {
      ICAL.TimezoneService.register(component);
    } catch {
      // A definition this cannot read leaves the time floating, which is the
      // behaviour without it. Not worth losing the appointment over.
    }
  }
}

/** Whether the file says this appointment is off. */
function isCancelled(component: ICAL.Component): boolean {
  const status = component.getFirstPropertyValue('status');
  return typeof status === 'string' && status.toUpperCase() === 'CANCELLED';
}

function occurrencesOf(event: ICAL.Event, window: Window): FeedEvent[] {
  if (!event.isRecurring()) {
    const one = toFeedEvent(event, event.startDate, event.endDate);
    return one && touches(one, window) ? [one] : [];
  }

  const found: FeedEvent[] = [];
  const iterator = event.iterator();

  for (let seen = 0; seen < MAX_OCCURRENCES; seen += 1) {
    const next = iterator.next();
    if (!next) break;

    let details;
    try {
      details = event.getOccurrenceDetails(next);
    } catch {
      continue;
    }

    // details.item is the occurrence the file actually describes: the master
    // for an ordinary date, and the edited version where the file replaced
    // one. Reading the title off the master would draw the old name at the
    // new time.
    const occurrence = toFeedEvent(details.item, details.startDate, details.endDate);
    if (!occurrence) continue;

    // Past the window and still stepping forwards: everything after this is
    // past it too.
    if (dayOf(occurrence.startsOn ?? occurrence.startsAt) > window.to) break;
    if (touches(occurrence, window)) found.push(occurrence);
  }

  return found;
}

/**
 * One occurrence as a row, or null if it cannot be made into one.
 *
 * An appointment with no start is not an appointment, and an end before its
 * start is refused by the table -- both are files this cannot do anything
 * useful with, so they are dropped rather than guessed at.
 */
function toFeedEvent(
  event: ICAL.Event,
  start: ICAL.Time | null,
  end: ICAL.Time | null,
): FeedEvent | null {
  if (!start) return null;

  const uid = event.uid?.trim();
  if (!uid) return null;

  const shared = {
    uid,
    title: event.summary?.trim() || UNTITLED,
    body: event.description?.trim() || null,
    location: event.location?.trim() || null,
  };

  if (start.isDate) {
    const startsOn = dayString(start);
    // A file says the day AFTER the last one; the table holds the last one.
    // A single day is written as start and start + 1, which comes back here
    // as the one day it is.
    const endsOn = end ? dayString(end.clone().adjust(-1, 0, 0, 0)) : startsOn;

    return { ...shared, startsOn, endsOn: endsOn < startsOn ? startsOn : endsOn, startsAt: null, endsAt: null };
  }

  const startsAt = start.toJSDate().toISOString();
  const endsAt = (end ?? start).toJSDate().toISOString();

  return {
    ...shared,
    startsOn: null,
    endsOn: null,
    startsAt,
    endsAt: endsAt < startsAt ? startsAt : endsAt,
  };
}

/** A whole-day time as the day it is. */
function dayString(time: ICAL.Time): string {
  const month = String(time.month).padStart(2, '0');
  const day = String(time.day).padStart(2, '0');
  return `${time.year}-${month}-${day}`;
}

/** The calendar day a value falls on. UTC for an instant, which is what the
 * window is measured in; the reader's own zone decides where it is drawn. */
function dayOf(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

/** Whether an occurrence covers any day the window asked for. */
function touches(event: FeedEvent, window: Window): boolean {
  const first = dayOf(event.startsOn ?? event.startsAt);
  const last = dayOf(event.endsOn ?? event.endsAt);
  return first <= window.to && (last === '' ? first : last) >= window.from;
}
