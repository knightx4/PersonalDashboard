import { describe, expect, it } from 'vitest';
import {
  dayBars,
  dayBarsLabel,
  emptyLine,
  formatDayValue,
  formatScale,
  periodDays,
  periodPhrase,
  type DayMeasure,
} from './day-bars';

const VIEWS: DayMeasure = { kind: 'count', one: 'view', many: 'views' };
const SPEND: DayMeasure = { kind: 'spend' };

describe('periodDays', () => {
  it('runs oldest first and ends on the end day', () => {
    expect(periodDays('2026-10-02', 3)).toEqual(['2026-09-30', '2026-10-01', '2026-10-02']);
  });

  it('gives thirty days for a month and one for a day', () => {
    expect(periodDays('2026-10-13', 30)).toHaveLength(30);
    expect(periodDays('2026-10-13', 30)[0]).toBe('2026-09-14');
    expect(periodDays('2026-10-13', 1)).toEqual(['2026-10-13']);
  });
});

describe('dayBars', () => {
  it('gives every day a slot, zero where nothing happened', () => {
    const chart = dayBars([{ day: '2026-10-12', value: 4 }], '2026-10-13', 3);
    expect(chart.bars.map((bar) => [bar.day, bar.value])).toEqual([
      ['2026-10-11', 0],
      ['2026-10-12', 4],
      ['2026-10-13', 0],
    ]);
  });

  it('scales every bar against the busiest day', () => {
    const chart = dayBars(
      [
        { day: '2026-10-12', value: 10 },
        { day: '2026-10-13', value: 40 },
      ],
      '2026-10-13',
      2,
    );
    expect(chart.high).toBe(40);
    expect(chart.bars.map((bar) => bar.share)).toEqual([0.25, 1]);
    expect(chart.busiest?.day).toBe('2026-10-13');
    expect(chart.total).toBe(50);
  });

  it('adds values on one day and leaves out the rest', () => {
    const chart = dayBars(
      [
        { day: '2026-10-13', value: 2 },
        { day: '2026-10-13', value: 3 },
        { day: '2026-09-01', value: 99 },
        { day: '2026-10-13', value: -4 },
        { day: '2026-10-13', value: Number.NaN },
      ],
      '2026-10-13',
      1,
    );
    expect(chart.bars).toEqual([{ day: '2026-10-13', value: 5, share: 1 }]);
    expect(chart.total).toBe(5);
  });

  it('has no busiest day when nothing happened', () => {
    const chart = dayBars([], '2026-10-13', 30);
    expect(chart.bars).toHaveLength(30);
    expect(chart.high).toBe(0);
    expect(chart.busiest).toBeNull();
    expect(chart.bars.every((bar) => bar.share === 0)).toBe(true);
  });

  it('takes the first of two equal days as the busiest', () => {
    const chart = dayBars(
      [
        { day: '2026-10-11', value: 3 },
        { day: '2026-10-12', value: 3 },
      ],
      '2026-10-13',
      3,
    );
    expect(chart.busiest?.day).toBe('2026-10-11');
  });
});

describe('the words', () => {
  it('counts with the noun the caller names', () => {
    expect(formatDayValue(0, VIEWS)).toBe('no views');
    expect(formatDayValue(1, VIEWS)).toBe('1 view');
    expect(formatDayValue(1204, VIEWS)).toBe('1,204 views');
    expect(formatScale(1204, VIEWS)).toBe('1,204');
  });

  it('prints spend from micro-dollars', () => {
    expect(formatDayValue(4_870_000, SPEND)).toBe('$4.87');
    expect(formatDayValue(0, SPEND)).toBe('nothing spent');
    expect(formatScale(1_840, SPEND)).toBe('$0.0018');
  });

  it('names the period and its empty line', () => {
    expect(periodPhrase(30)).toBe('in 30 days');
    expect(periodPhrase(1)).toBe('today');
    expect(emptyLine(30)).toBe('Nothing in the last 30 days.');
  });

  it('reads the chart aloud', () => {
    const chart = dayBars(
      [
        { day: '2026-10-12', value: 1 },
        { day: '2026-10-13', value: 3 },
      ],
      '2026-10-13',
      30,
    );
    expect(dayBarsLabel('Page views', chart, VIEWS)).toBe(
      'Page views: 4 views in 30 days, on 2 of 30 days. Busiest 2026-10-13, 3 views.',
    );
    expect(dayBarsLabel('Page views', dayBars([], '2026-10-13', 30), VIEWS)).toBe(
      'Page views: no views in 30 days',
    );
  });
});
