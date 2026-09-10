import { addDays, todayIn } from '@/lib/todo/tasks/model';

/**
 * What an event is, and which days of the calendar it covers.
 *
 * An event is not a task. A task has a status, is ticked off and sits in a
 * pile; an event has a start and an end and there is nothing to tick. They are
 * separate tables and separate types so that no reader has to remember to
 * filter one out of the other.
 *
 * Pure, like lib/todo/tasks/model.ts beside it and for the same reason:
 * everything that can be wrong here is a date question -- whether a 23:00
 * meeting that runs to 01:00 is on one day or two, whether an evening instant
 * is tonight for this reader -- and a date question that needs a database to
 * test is a date question that stays wrong.
 */

export interface Event {
  id: string;
  title: string;
  body: string | null;
  /** Free text: a room, a postcode, a video link. Nothing parses it. */
  location: string | null;
  /** The first day of an all-day event. Null on a timed one. */
  startsOn: string | null;
  /** The last day of an all-day event, inclusive. Equal to startsOn for one day. */
  endsOn: string | null;
  /** When a timed event starts. Null on an all-day one. */
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

/** All day, or on the clock. Exactly one, which the table also enforces. */
export function isAllDay(event: Pick<Event, 'startsOn'>): boolean {
  return event.startsOn !== null;
}

/** The day an event begins, where the reader is standing. */
export function startDay(event: Event, timezone: string): string {
  if (event.startsOn) return event.startsOn;
  return todayIn(timezone, new Date(event.startsAt as string));
}

/**
 * The last day an event is on, where the reader is standing.
 *
 * An end at exactly midnight belongs to the day before it. A meeting booked
 * 22:00 to 00:00 is an evening, not two days, and drawing it on tomorrow as
 * well would put a stripe on a day nothing happens on. So the timed end is
 * asked about the millisecond before it, and never allowed to fall earlier
 * than the day the event starts.
 */
export function endDay(event: Event, timezone: string): string {
  if (event.endsOn) return event.endsOn;

  const end = new Date(event.endsAt as string);
  const last = todayIn(timezone, new Date(end.getTime() - 1));
  const first = startDay(event, timezone);
  return last < first ? first : last;
}

/**
 * Every calendar day an event covers, in order.
 *
 * This is what the calendar draws from: a holiday running Monday to Friday is
 * a pill on each of those five days, and a meeting from 23:00 to 01:00 is on
 * both the night it starts and the morning it ends.
 */
export function eventDays(event: Event, timezone: string): string[] {
  const first = startDay(event, timezone);
  const last = endDay(event, timezone);

  const days: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 1)) days.push(day);
  return days;
}

/**
 * How two events sort against each other.
 *
 * By the day they start, then all-day before timed -- a day off is the frame
 * the day's appointments sit inside, so it reads first -- then by the clock,
 * then by title so that the order never depends on which came back first.
 */
export function compareEvents(a: Event, b: Event, timezone: string): number {
  const dayA = startDay(a, timezone);
  const dayB = startDay(b, timezone);
  if (dayA !== dayB) return dayA < dayB ? -1 : 1;

  if (isAllDay(a) !== isAllDay(b)) return isAllDay(a) ? -1 : 1;

  if (a.startsAt && b.startsAt && a.startsAt !== b.startsAt) {
    return a.startsAt < b.startsAt ? -1 : 1;
  }

  return a.title.localeCompare(b.title);
}

/** The wall clock of an instant, where the reader is standing. */
function clockIn(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** What the form shows when an event is opened to be changed. */
export interface EventFields {
  allDay: boolean;
  startDay: string;
  /** Blank when the event begins and ends on the same day. */
  endDay: string;
  startTime: string;
  endTime: string;
}

/**
 * A stored event, as the fields of the form that wrote it.
 *
 * The reverse of resolveSpan in write.ts, and it has to be its exact reverse:
 * opening an event and saving it again without touching anything must leave
 * the same row. So a timed event is read back in the reader's own zone, and an
 * end at midnight keeps the next day's date with 00:00 on it rather than being
 * tidied into 24:00 of a day that has no such hour.
 */
export function eventFields(event: Event, timezone: string): EventFields {
  if (isAllDay(event)) {
    const start = event.startsOn as string;
    const end = event.endsOn as string;
    return {
      allDay: true,
      startDay: start,
      endDay: end === start ? '' : end,
      startTime: '',
      endTime: '',
    };
  }

  const startsAt = event.startsAt as string;
  const endsAt = event.endsAt as string;
  const start = todayIn(timezone, new Date(startsAt));
  const end = todayIn(timezone, new Date(endsAt));

  return {
    allDay: false,
    startDay: start,
    endDay: end === start ? '' : end,
    startTime: clockIn(startsAt, timezone),
    endTime: clockIn(endsAt, timezone),
  };
}
