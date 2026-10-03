import { describe, expect, it } from 'vitest';
import {
  countKinds,
  groupByMonth,
  isMonthKey,
  monthKeyOf,
  monthLabel,
  monthStart,
  monthWindow,
  parseTimelineModule,
  shiftMonth,
} from './months';
import type { TimelineEvent } from './timeline';

function event(occurred_at: string, kind: TimelineEvent['kind'], module: TimelineEvent['module']): TimelineEvent {
  return {
    occurred_at,
    module,
    kind,
    title: kind,
    detail: null,
    amount_cents: null,
    currency: null,
    source_table: 'x.y',
    source_id: `${kind}-${occurred_at}`,
    link_ref: null,
    ref: `x.y:${kind}-${occurred_at}`,
  };
}

describe('months', () => {
  it('reads the month on the person’s calendar, not UTC’s', () => {
    // 03:00 UTC on 1 October is still 30 September in New York.
    expect(monthKeyOf('2026-10-01T03:00:00Z', 'America/New_York')).toBe('2026-09');
    expect(monthKeyOf('2026-10-01T03:00:00Z', 'UTC')).toBe('2026-10');
  });

  it('shifts across years both ways', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2025-12', 1)).toBe('2026-01');
    expect(shiftMonth('2026-09', -11)).toBe('2025-10');
    expect(shiftMonth('2026-09', 12)).toBe('2027-09');
  });

  it('names a month', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
  });

  it('checks a month key', () => {
    expect(isMonthKey('2026-09')).toBe(true);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('26-09')).toBe(false);
    expect(isMonthKey(undefined)).toBe(false);
  });

  it('starts a month at local midnight, clock changes included', () => {
    expect(monthStart('2026-09', 'UTC')).toBe('2026-09-01T00:00:00.000Z');
    expect(monthStart('2026-09', 'America/New_York')).toBe('2026-09-01T04:00:00.000Z');
    expect(monthStart('2026-12', 'America/New_York')).toBe('2026-12-01T05:00:00.000Z');
    expect(monthStart('2026-04', 'Europe/London')).toBe('2026-03-31T23:00:00.000Z');
    expect(monthStart('2026-10', 'Asia/Kolkata')).toBe('2026-09-30T18:30:00.000Z');
  });

  it('covers twelve months ending with the one named', () => {
    expect(monthWindow('2026-09', 'UTC')).toEqual({
      first: '2025-10',
      last: '2026-09',
      from: '2025-10-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    });
  });

  it('groups newest month first, counts per kind in the kinds’ order, and drops months outside', () => {
    const events = [
      event('2026-09-20T12:00:00Z', 'note_written', 'vault'),
      event('2026-09-12T12:00:00Z', 'rejected', 'jobs'),
      event('2026-09-10T12:00:00Z', 'applied', 'jobs'),
      event('2026-09-02T12:00:00Z', 'applied', 'jobs'),
      event('2026-07-04T12:00:00Z', 'ordered', 'shopping'),
      event('2025-09-30T12:00:00Z', 'ordered', 'shopping'),
    ];
    const months = groupByMonth(events, 'UTC', { first: '2025-10', last: '2026-09' });
    expect(months.map((m) => m.key)).toEqual(['2026-09', '2026-07']);
    expect(months[0].label).toBe('September 2026');
    expect(months[0].counts).toEqual([
      { kind: 'applied', count: 2 },
      { kind: 'rejected', count: 1 },
      { kind: 'note_written', count: 1 },
    ]);
    expect(months[0].events.map((e) => e.occurred_at)).toEqual([
      '2026-09-20T12:00:00Z',
      '2026-09-12T12:00:00Z',
      '2026-09-10T12:00:00Z',
      '2026-09-02T12:00:00Z',
    ]);
  });

  it('counts nothing for nothing', () => {
    expect(countKinds([])).toEqual([]);
  });

  it('takes a module from the address only when the timeline reads it and it is on', () => {
    expect(parseTimelineModule('jobs', ['jobs', 'vault'])).toBe('jobs');
    expect(parseTimelineModule('shopping', ['jobs', 'vault'])).toBeNull();
    expect(parseTimelineModule('news', ['news'])).toBeNull();
    expect(parseTimelineModule(undefined, ['jobs'])).toBeNull();
  });
});
