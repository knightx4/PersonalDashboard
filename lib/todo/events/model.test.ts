import { describe, expect, it } from 'vitest';
import { compareEvents, endDay, eventDays, isAllDay, startDay, type Event } from '@/lib/todo/events/model';

function event(fields: Partial<Event>): Event {
  return {
    id: 'e1',
    title: 'Something',
    body: null,
    location: null,
    startsOn: null,
    endsOn: null,
    startsAt: null,
    endsAt: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...fields,
  };
}

describe('eventDays', () => {
  it('puts a one-day all-day event on one day', () => {
    const days = eventDays(event({ startsOn: '2026-03-10', endsOn: '2026-03-10' }), 'Europe/London');
    expect(days).toEqual(['2026-03-10']);
  });

  it('puts an all-day event over three days on all three', () => {
    const days = eventDays(event({ startsOn: '2026-03-10', endsOn: '2026-03-12' }), 'Asia/Tokyo');
    expect(days).toEqual(['2026-03-10', '2026-03-11', '2026-03-12']);
  });

  it('does not move an all-day event for a reader in another zone', () => {
    // The reason the dates are dates: a week off must not start on Sunday
    // because you read the calendar from Los Angeles.
    const holiday = event({ startsOn: '2026-03-10', endsOn: '2026-03-11' });
    expect(eventDays(holiday, 'America/Los_Angeles')).toEqual(eventDays(holiday, 'Pacific/Auckland'));
  });

  it('puts an evening that runs past midnight on both days', () => {
    const days = eventDays(
      event({ startsAt: '2026-03-10T23:00:00.000Z', endsAt: '2026-03-11T01:00:00.000Z' }),
      'UTC',
    );
    expect(days).toEqual(['2026-03-10', '2026-03-11']);
  });

  it('keeps an event ending exactly at midnight on the day it ran', () => {
    // 22:00 to midnight is an evening, not two days.
    const days = eventDays(
      event({ startsAt: '2026-03-10T22:00:00.000Z', endsAt: '2026-03-11T00:00:00.000Z' }),
      'UTC',
    );
    expect(days).toEqual(['2026-03-10']);
  });

  it('files a timed event under the day it falls on for this reader', () => {
    // 23:30 UTC is already tomorrow in Tokyo and still this afternoon in
    // Los Angeles.
    const meeting = event({
      startsAt: '2026-03-10T23:30:00.000Z',
      endsAt: '2026-03-10T23:45:00.000Z',
    });
    expect(eventDays(meeting, 'Asia/Tokyo')).toEqual(['2026-03-11']);
    expect(eventDays(meeting, 'America/Los_Angeles')).toEqual(['2026-03-10']);
  });

  it('never ends an event before it starts', () => {
    const zeroLength = event({
      startsAt: '2026-03-10T09:00:00.000Z',
      endsAt: '2026-03-10T09:00:00.000Z',
    });
    expect(startDay(zeroLength, 'UTC')).toBe('2026-03-10');
    expect(endDay(zeroLength, 'UTC')).toBe('2026-03-10');
    expect(eventDays(zeroLength, 'UTC')).toEqual(['2026-03-10']);
  });
});

describe('isAllDay', () => {
  it('reads the pair of columns that is filled', () => {
    expect(isAllDay(event({ startsOn: '2026-03-10', endsOn: '2026-03-10' }))).toBe(true);
    expect(
      isAllDay(event({ startsAt: '2026-03-10T09:00:00.000Z', endsAt: '2026-03-10T10:00:00.000Z' })),
    ).toBe(false);
  });
});

describe('compareEvents', () => {
  const holiday = event({ id: 'a', title: 'Holiday', startsOn: '2026-03-10', endsOn: '2026-03-12' });
  const morning = event({
    id: 'b',
    title: 'Standup',
    startsAt: '2026-03-10T09:00:00.000Z',
    endsAt: '2026-03-10T09:15:00.000Z',
  });
  const afternoon = event({
    id: 'c',
    title: 'Dentist',
    startsAt: '2026-03-10T15:00:00.000Z',
    endsAt: '2026-03-10T15:30:00.000Z',
  });
  const tomorrow = event({ id: 'd', title: 'Flight', startsOn: '2026-03-11', endsOn: '2026-03-11' });

  it('orders by day, then all day first, then by the clock', () => {
    const sorted = [afternoon, tomorrow, morning, holiday]
      .sort((a, b) => compareEvents(a, b, 'UTC'))
      .map((e) => e.id);
    expect(sorted).toEqual(['a', 'b', 'c', 'd']);
  });

  it('falls back to the title so the order does not depend on the query', () => {
    const other = event({ ...morning, id: 'z', title: 'Ablutions' });
    expect(compareEvents(morning, other, 'UTC')).toBeGreaterThan(0);
  });
});
