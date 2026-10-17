import { describe, expect, it } from 'vitest';
import {
  METRIC_BARS,
  axisLabel,
  barLine,
  metricChart,
  metricSummary,
  namedLists,
  nothingCounted,
  periodLabel,
  targetLine,
} from '@/lib/goals/metric-chart';
import { countByPeriod, type PeriodCount } from '@/lib/goals/metrics';

const weeks = (counts: number[]): PeriodCount[] =>
  counts.map((count, i) => {
    const start = new Date(Date.UTC(2026, 7, 3 + i * 7));
    const end = new Date(start.getTime() + 7 * 86_400_000);
    return { startsOn: start.toISOString().slice(0, 10), endsOn: end.toISOString().slice(0, 10), count };
  });

describe('metricChart', () => {
  it('draws nothing with no periods', () => {
    expect(metricChart([], 'week', 3)).toBeNull();
  });

  it('keeps the latest twelve periods, oldest first', () => {
    const counts = weeks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    const chart = metricChart(counts, 'week', null)!;
    expect(chart.bars).toHaveLength(METRIC_BARS);
    expect(chart.bars[0].count).toBe(3);
    expect(chart.latest).toBe(14);
    expect(chart.high).toBe(14);
    expect(chart.bars[11].share).toBe(1);
  });

  it('lifts the scale to a target above every count', () => {
    const chart = metricChart(weeks([0, 1, 2]), 'week', 4)!;
    expect(chart.high).toBe(4);
    expect(chart.targetShare).toBe(1);
    expect(chart.bars[2].share).toBe(0.5);
  });

  it('keeps a scale of one when every count is zero', () => {
    const chart = metricChart(weeks([0, 0]), 'week', null)!;
    expect(chart.high).toBe(1);
    expect(chart.targetShare).toBeNull();
  });

  it('matches the counts countByPeriod gives the stored records', () => {
    const counts = countByPeriod({
      records: ['2026-10-05', '2026-10-06', '2026-10-13', '2026-09-30'].map((day) => ({
        data: { on: day },
        draft: false,
      })),
      dateField: 'on',
      period: 'week',
      goalStartedAt: '2026-09-28T09:00:00Z',
      now: new Date('2026-10-15T12:00:00Z'),
      timeZone: 'Europe/London',
    });
    const chart = metricChart(counts, 'week', null)!;
    expect(chart.bars.map((b) => [b.startsOn, b.count])).toEqual([
      ['2026-09-28', 1],
      ['2026-10-05', 2],
      ['2026-10-12', 1],
    ]);
    expect(metricSummary(chart, 'week')).toBe('4 in the last 3 weeks, 1 this week');
  });
});

describe('the words', () => {
  it('names periods', () => {
    expect(periodLabel('week', '2026-10-05')).toBe('Week of 5 Oct');
    expect(periodLabel('month', '2026-10-01')).toBe('October 2026');
    expect(axisLabel('month', '2026-06-01')).toBe('Jun');
  });

  it('says only the latest for one period', () => {
    const chart = metricChart(weeks([2]), 'week', null)!;
    expect(metricSummary(chart, 'week')).toBe('2 this week');
  });

  it('names a month summary, a target and a bar', () => {
    const chart = metricChart(weeks([1, 0]), 'month', 1)!;
    expect(metricSummary(chart, 'month')).toBe('1 in the last 2 months, 0 this month');
    expect(targetLine(3, 'week')).toBe('Target 3 a week');
    expect(barLine({ ...chart.bars[0], label: 'Week of 3 Aug' })).toBe('Week of 3 Aug: 1');
  });

  it('knows when nothing was ever counted', () => {
    expect(nothingCounted(weeks([0, 0]))).toBe(true);
    expect(nothingCounted(weeks([0, 1]))).toBe(false);
    expect(nothingCounted([])).toBe(true);
  });
});

describe('namedLists', () => {
  it('names the list and field each metric reads, or null', () => {
    const lists = [
      { id: 'c1', name: 'Job applications', fields: [{ key: 'applied_on', label: 'Applied on' }] },
    ];
    const named = namedLists(
      [
        { collectionId: 'c1', dateField: 'applied_on' },
        { collectionId: 'c1', dateField: 'gone' },
        { collectionId: 'c2', dateField: 'applied_on' },
      ],
      lists,
    );
    expect(named.map((m) => [m.list, m.field])).toEqual([
      ['Job applications', 'Applied on'],
      ['Job applications', null],
      [null, null],
    ]);
  });
});
