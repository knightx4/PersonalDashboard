import { describe, expect, it } from 'vitest';
import { countByPeriod, dateFields, metricInputError, type CountedRecord } from '@/lib/goals/metrics';

const rec = (applied: string | null, extra: Partial<CountedRecord> = {}): CountedRecord => ({
  data: applied === null ? {} : { applied },
  draft: false,
  ...extra,
});

const base = {
  dateField: 'applied',
  goalStartedAt: null,
  timeZone: 'UTC',
};

describe('countByPeriod by week', () => {
  it('counts each Monday week and shows the weeks with none as zero', () => {
    const counts = countByPeriod({
      ...base,
      period: 'week',
      // Thursday 15 October 2026
      now: new Date('2026-10-15T12:00:00Z'),
      records: [rec('2026-09-28'), rec('2026-10-04'), rec('2026-10-14'), rec('2026-10-12')],
    });
    expect(counts).toEqual([
      { startsOn: '2026-09-28', endsOn: '2026-10-05', count: 2 },
      { startsOn: '2026-10-05', endsOn: '2026-10-12', count: 0 },
      { startsOn: '2026-10-12', endsOn: '2026-10-19', count: 2 },
    ]);
  });

  it('leaves out drafts, archived records and records with no date', () => {
    const counts = countByPeriod({
      ...base,
      period: 'week',
      now: new Date('2026-10-15T12:00:00Z'),
      records: [
        rec('2026-10-13'),
        rec('2026-10-13', { draft: true }),
        rec('2026-10-13', { archivedAt: '2026-10-14T09:00:00Z' }),
        rec(null),
        { data: { applied: 'not a date' }, draft: false },
      ],
    });
    expect(counts).toEqual([{ startsOn: '2026-10-12', endsOn: '2026-10-19', count: 1 }]);
  });

  it('starts at the goal when it is older than every record', () => {
    const counts = countByPeriod({
      ...base,
      period: 'week',
      goalStartedAt: '2026-09-30T10:00:00Z',
      now: new Date('2026-10-15T12:00:00Z'),
      records: [rec('2026-10-14')],
    });
    expect(counts.map((p) => [p.startsOn, p.count])).toEqual([
      ['2026-09-28', 0],
      ['2026-10-05', 0],
      ['2026-10-12', 1],
    ]);
  });

  it('starts at a record older than the goal, so every record is counted', () => {
    const counts = countByPeriod({
      ...base,
      period: 'week',
      goalStartedAt: '2026-10-13T10:00:00Z',
      now: new Date('2026-10-15T12:00:00Z'),
      records: [rec('2026-10-01')],
    });
    expect(counts.map((p) => [p.startsOn, p.count])).toEqual([
      ['2026-09-28', 1],
      ['2026-10-05', 0],
      ['2026-10-12', 0],
    ]);
  });

  it('gives a new goal with no records its one week at zero', () => {
    const counts = countByPeriod({
      ...base,
      period: 'week',
      goalStartedAt: '2026-10-15T08:00:00Z',
      now: new Date('2026-10-15T12:00:00Z'),
      records: [],
    });
    expect(counts).toEqual([{ startsOn: '2026-10-12', endsOn: '2026-10-19', count: 0 }]);
  });

  it('has no periods with no goal start and no records', () => {
    expect(countByPeriod({ ...base, period: 'week', now: new Date(), records: [] })).toEqual([]);
  });

  it('ends at today, so a record dated later is not counted', () => {
    const counts = countByPeriod({
      ...base,
      period: 'week',
      now: new Date('2026-10-15T12:00:00Z'),
      records: [rec('2026-10-13'), rec('2026-11-02')],
    });
    expect(counts).toEqual([{ startsOn: '2026-10-12', endsOn: '2026-10-19', count: 1 }]);
  });
});

describe('countByPeriod in the account time zone', () => {
  // 02:00 UTC on Monday 12 October is still Sunday 11 October in New York.
  const now = new Date('2026-10-12T02:00:00Z');

  it('ends at the week holding today in the account zone, not in UTC', () => {
    const records = [rec('2026-10-08')];
    const utc = countByPeriod({ ...base, period: 'week', now, records });
    const newYork = countByPeriod({ ...base, period: 'week', now, records, timeZone: 'America/New_York' });
    expect(utc.map((p) => p.startsOn)).toEqual(['2026-10-05', '2026-10-12']);
    expect(newYork.map((p) => p.startsOn)).toEqual(['2026-10-05']);
  });

  it('reads the goal start as a day in the account zone', () => {
    // 23:30 UTC on Sunday 4 October is 00:30 on Monday 5 October in London.
    const goalStartedAt = '2026-10-04T23:30:00Z';
    const london = countByPeriod({
      ...base,
      period: 'week',
      goalStartedAt,
      now,
      records: [],
      timeZone: 'Europe/London',
    });
    const utc = countByPeriod({ ...base, period: 'week', goalStartedAt, now, records: [] });
    expect(london[0].startsOn).toBe('2026-10-05');
    expect(utc[0].startsOn).toBe('2026-09-28');
  });

  it('falls back to UTC for a zone it does not know', () => {
    const counts = countByPeriod({ ...base, period: 'week', now, records: [rec('2026-10-12')], timeZone: 'Nowhere/Else' });
    expect(counts).toEqual([{ startsOn: '2026-10-12', endsOn: '2026-10-19', count: 1 }]);
  });
});

describe('countByPeriod by month', () => {
  it('counts each calendar month, across a year end, with empty months as zero', () => {
    const counts = countByPeriod({
      ...base,
      period: 'month',
      now: new Date('2027-02-10T12:00:00Z'),
      records: [rec('2026-11-30'), rec('2026-11-01'), rec('2027-02-01')],
    });
    expect(counts).toEqual([
      { startsOn: '2026-11-01', endsOn: '2026-12-01', count: 2 },
      { startsOn: '2026-12-01', endsOn: '2027-01-01', count: 0 },
      { startsOn: '2027-01-01', endsOn: '2027-02-01', count: 0 },
      { startsOn: '2027-02-01', endsOn: '2027-03-01', count: 1 },
    ]);
  });

  it('puts the last day of a month in that month whatever the zone', () => {
    const counts = countByPeriod({
      ...base,
      period: 'month',
      now: new Date('2026-11-01T03:00:00Z'),
      timeZone: 'America/Los_Angeles',
      records: [rec('2026-10-31')],
    });
    // Still 31 October in Los Angeles, so October is the last month.
    expect(counts).toEqual([{ startsOn: '2026-10-01', endsOn: '2026-11-01', count: 1 }]);
  });
});

describe('metricInputError', () => {
  const good = { name: 'Applications', source: 'list' as const, collectionId: 'c1', dateField: 'applied', period: 'week' as const, target: 5 };

  it('passes a whole metric and one with no target', () => {
    expect(metricInputError(good)).toBeNull();
    expect(metricInputError({ ...good, target: null })).toBeNull();
  });

  it('names the field at fault', () => {
    expect(metricInputError({ ...good, name: '  ' })?.field).toBe('name');
    expect(metricInputError({ ...good, collectionId: '' })?.field).toBe('collectionId');
    expect(metricInputError({ ...good, dateField: 'Applied On' })?.field).toBe('dateField');
    expect(metricInputError({ ...good, period: 'day' as never })?.field).toBe('period');
    expect(metricInputError({ ...good, target: 0 })?.field).toBe('target');
    expect(metricInputError({ ...good, target: 2.5 })?.field).toBe('target');
    expect(metricInputError({ ...good, source: 'notes' as never })?.field).toBe('source');
    expect(metricInputError({ ...good, dateField: null })?.field).toBe('dateField');
  });

  it('asks for a list and a date only when counting a list', () => {
    for (const source of ['steps', 'files'] as const) {
      expect(metricInputError({ ...good, source, collectionId: null, dateField: null })).toBeNull();
    }
  });
});

describe('dateFields', () => {
  it('keeps the live date fields only', () => {
    expect(
      dateFields([
        { key: 'applied', label: 'Applied', type: 'date' },
        { key: 'old', label: 'Old', type: 'date', removed: true },
        { key: 'company', label: 'Company', type: 'text' },
      ]).map((f) => f.key),
    ).toEqual(['applied']);
  });
});
