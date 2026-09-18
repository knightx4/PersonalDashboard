import { endDay, isAllDay, startDay, type Event } from '@/lib/todo/events/model';
import type { DayContext } from '@/lib/todo/agenda/sources';

/**
 * Events, as the day context the agenda already draws.
 *
 * An event is not a task and never becomes one: it has no status, so there is
 * nothing to tick, defer or dismiss. That is the same shape an interview
 * already has on this page, and it is why these are context rows rather than
 * items -- an item carries actions a source can perform, and a calendar entry
 * you typed has none.
 *
 * PURE, like merge.ts beside it. Everything that can be wrong here is a date
 * question, and a date question that needs a database to test stays wrong.
 */

/**
 * One row per event, on the day it is next relevant.
 *
 * An event that began before today shows on today rather than on the day it
 * started: a holiday that runs Monday to Friday is still what Wednesday holds,
 * and the merge drops anything dated before today because an appointment in
 * the past is over rather than overdue. One row and not one per day it covers,
 * because a week off would otherwise fill the piles with seven copies of
 * itself.
 *
 * The clock is shown only on the day the event actually starts. A meeting that
 * began yesterday at 23:00 is not a 23:00 thing about today.
 */
export function eventContext(
  events: readonly Event[],
  timezone: string,
  today: string,
): DayContext[] {
  return contextFor(events, timezone, today, 'own');
}

/**
 * The same, for an appointment out of a calendar you subscribe to.
 *
 * #209 settled that an event belongs on the agenda as context rather than as
 * something to tick, and a subscribed appointment is an event -- so it follows
 * that answer: no tick, no defer, no dismiss. The one difference is where the
 * row goes when you press it. There is no page for an appointment this app did
 * not write, so it opens the day on the calendar rather than a form for a row
 * that cannot be edited.
 */
export function subscribedContext(
  events: readonly Event[],
  timezone: string,
  today: string,
): DayContext[] {
  return contextFor(events, timezone, today, 'subscribed');
}

function contextFor(
  events: readonly Event[],
  timezone: string,
  today: string,
  kind: 'own' | 'subscribed',
): DayContext[] {
  const context: DayContext[] = [];

  for (const event of events) {
    const first = startDay(event, timezone);
    const last = endDay(event, timezone);
    if (last < today) continue;

    const day = first < today ? today : first;
    const timed = !isAllDay(event);

    const query =
      kind === 'own'
        ? new URLSearchParams({ date: day, event: event.id })
        : new URLSearchParams({ date: day });

    context.push({
      key: `${kind === 'own' ? 'event' : 'feed'}:${event.id}`,
      day,
      at: timed && day === first ? event.startsAt : null,
      label: event.title,
      detail: detailOf(event, first, last),
      link: { href: `/todo/calendar?${query}`, label: 'Open' },
    });
  }

  return context;
}

/** Where it is, and how far it runs when that is more than the one day. */
function detailOf(event: Event, first: string, last: string): string | null {
  const parts: string[] = [];
  if (event.location) parts.push(event.location);
  if (last !== first) parts.push(`until ${dayLabel(last)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * A calendar day as words. Read in UTC on purpose: the day is already the
 * reader's own, and putting it through a zone a second time would move it.
 */
function dayLabel(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${day}T00:00:00.000Z`));
}
