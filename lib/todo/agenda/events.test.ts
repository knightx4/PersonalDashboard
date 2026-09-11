import { describe, expect, it } from 'vitest';
import { eventContext } from '@/lib/todo/agenda/events';
import type { Event } from '@/lib/todo/events/model';

const TIMEZONE = 'Europe/London';
const TODAY = '2026-03-10';

function event(over: Partial<Event> = {}): Event {
  return {
    id: 'e1',
    title: 'Standup',
    body: null,
    location: null,
    startsOn: null,
    endsOn: null,
    startsAt: '2026-03-10T09:00:00.000Z',
    endsAt: '2026-03-10T09:30:00.000Z',
    createdAt: '2026-03-01T00:00:00.000Z',
    ...over,
  };
}

describe('eventContext', () => {
  it('gives a timed event its own day and its start instant', () => {
    const [row] = eventContext([event()], TIMEZONE, TODAY);

    expect(row.key).toBe('event:e1');
    expect(row.day).toBe('2026-03-10');
    expect(row.at).toBe('2026-03-10T09:00:00.000Z');
    expect(row.label).toBe('Standup');
  });

  it('gives an all-day event no clock', () => {
    const [row] = eventContext(
      [event({ title: 'Bank holiday', startsOn: '2026-03-12', endsOn: '2026-03-12', startsAt: null, endsAt: null })],
      TIMEZONE,
      TODAY,
    );

    expect(row.day).toBe('2026-03-12');
    expect(row.at).toBeNull();
    expect(row.detail).toBeNull();
  });

  it('keeps a run of days on today once it has started, and says how far it runs', () => {
    const [row] = eventContext(
      [event({ title: 'Lisbon', startsOn: '2026-03-08', endsOn: '2026-03-13', startsAt: null, endsAt: null })],
      TIMEZONE,
      TODAY,
    );

    expect(row.day).toBe(TODAY);
    expect(row.detail).toBe('until Fri 13 Mar');
  });

  it('drops an event that is over', () => {
    expect(
      eventContext(
        [event({ startsAt: '2026-03-09T09:00:00.000Z', endsAt: '2026-03-09T10:00:00.000Z' })],
        TIMEZONE,
        TODAY,
      ),
    ).toEqual([]);
  });

  it('drops the clock on a timed event that began on an earlier day', () => {
    // 23:00 yesterday to 01:00 today is not a 23:00 thing about today.
    const [row] = eventContext(
      [event({ startsAt: '2026-03-09T23:00:00.000Z', endsAt: '2026-03-10T01:00:00.000Z' })],
      TIMEZONE,
      TODAY,
    );

    expect(row.day).toBe(TODAY);
    expect(row.at).toBeNull();
  });

  it('shows where it is, and links to it on the calendar', () => {
    const [row] = eventContext([event({ location: 'Room 3' })], TIMEZONE, TODAY);

    expect(row.detail).toBe('Room 3');
    expect(row.link).toEqual({ href: '/todo/calendar?date=2026-03-10&event=e1', label: 'Open' });
  });
});
