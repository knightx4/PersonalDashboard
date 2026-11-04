import { describe, expect, it } from 'vitest';
import { aimText, hoursPage, paceText, shadeOf, weekdaysThrough, type HoursMetric } from '@/lib/goals/hours';
import { hoursOf, loggedHourDays, metricInputError, sumDaysByPeriod } from '@/lib/goals/metrics';

const metric = (days: HoursMetric['days'], extra: Partial<HoursMetric> = {}): HoursMetric => ({
  id: 'm1',
  name: 'Applying',
  goalId: 'g1',
  goalTitle: 'Land your next role',
  target: 10,
  targetHigh: 15,
  days,
  ...extra,
});

// Wednesday 28 October 2026; the week starts on Monday the 26th.
const TODAY = '2026-10-28';

describe('hoursOf', () => {
  it('reads hours and minutes in the spellings capture writes', () => {
    expect(hoursOf(2, 'h')).toBe(2);
    expect(hoursOf(2.5, 'Hours')).toBe(2.5);
    expect(hoursOf(1, 'hr.')).toBe(1);
    expect(hoursOf(90, 'minutes')).toBe(1.5);
    expect(hoursOf(30, 'min')).toBe(0.5);
  });

  it('leaves out anything that is not time', () => {
    expect(hoursOf(2, 'bags')).toBeNull();
    expect(hoursOf(2, null)).toBeNull();
    expect(hoursOf(null, 'hours')).toBeNull();
    expect(hoursOf(0, 'hours')).toBeNull();
  });
});

describe('loggedHourDays', () => {
  it('keeps live time entries only', () => {
    expect(
      loggedHourDays([
        { happenedOn: '2026-10-26', quantity: 2, unit: 'h' },
        { happenedOn: '2026-10-26', quantity: 3, unit: 'bags' },
        { happenedOn: '2026-10-27', quantity: 1, unit: 'hours', undoneAt: '2026-10-27T10:00:00Z' },
      ]),
    ).toEqual([{ day: '2026-10-26', amount: 2 }]);
  });
});

describe('sumDaysByPeriod', () => {
  it('adds up the amounts in each week, with a zero for a week with none', () => {
    const weeks = sumDaysByPeriod({
      amounts: [
        { day: '2026-10-12', amount: 0.1 },
        { day: '2026-10-13', amount: 0.2 },
        { day: '2026-10-27', amount: 2.5 },
      ],
      period: 'week',
      goalStartedAt: null,
      now: new Date('2026-10-28T12:00:00Z'),
      timeZone: 'UTC',
    });
    expect(weeks.map((w) => [w.startsOn, w.count])).toEqual([
      ['2026-10-12', 0.3],
      ['2026-10-19', 0],
      ['2026-10-26', 2.5],
    ]);
  });
});

describe('metricInputError on a range aim', () => {
  const input = { name: 'Applying', source: 'hours' as const, collectionId: null, dateField: null, period: 'week' as const };
  it('takes a top above the low end', () => {
    expect(metricInputError({ ...input, target: 10, targetHigh: 15 })).toBeNull();
  });
  it('refuses a top without a low end, or not above it', () => {
    expect(metricInputError({ ...input, target: null, targetHigh: 15 })?.field).toBe('targetHigh');
    expect(metricInputError({ ...input, target: 10, targetHigh: 10 })?.field).toBe('targetHigh');
  });
});

describe('weekdaysThrough', () => {
  it('counts Monday to Friday and stops at five', () => {
    expect(weekdaysThrough('2026-10-26')).toBe(1);
    expect(weekdaysThrough('2026-10-30')).toBe(5);
    expect(weekdaysThrough('2026-10-31')).toBe(5);
    expect(weekdaysThrough('2026-11-01')).toBe(5);
  });
});

describe('hoursPage', () => {
  it('sets this week against the weekday pace', () => {
    const page = hoursPage(
      [metric([
        { day: '2026-10-26', hours: 2 },
        { day: '2026-10-27', hours: 1.5 },
      ])],
      TODAY,
    );
    const week = page.rows[0].week;
    expect(week.hours).toBe(3.5);
    // Three weekdays of an aim of 10 is 6.
    expect(week.expected).toBe(6);
    expect(week.pace).toBe('behind');
    expect(paceText(week)).toBe('2.5 h behind pace');
  });

  it('counts weekend time in the week but not in the pace', () => {
    const page = hoursPage([metric([{ day: '2026-10-25', hours: 4 }])], '2026-10-25');
    expect(page.rows[0].week).toMatchObject({ hours: 4, expected: 10, pace: 'behind' });
  });

  it('lays out four weeks of days from a Monday, with each row on them', () => {
    const page = hoursPage([metric([{ day: '2026-10-27', hours: 2 }, { day: '2026-10-27', hours: 1 }])], TODAY);
    expect(page.gridDays).toHaveLength(28);
    expect(page.gridDays[0]).toBe('2026-10-05');
    expect(page.rows[0].grid[page.gridDays.indexOf('2026-10-27')]).toBe(3);
    expect(page.dayHigh).toBe(3);
  });

  it('reads the full weeks for the averages, the best week and the streak', () => {
    const days = [
      // Week of 12 Oct: 12 h, week of 19 Oct: 11 h, both on aim.
      { day: '2026-10-12', hours: 12 },
      { day: '2026-10-19', hours: 11 },
      // Week of 5 Oct: 4 h, short.
      { day: '2026-10-05', hours: 4 },
      // This week does not count towards the full weeks.
      { day: '2026-10-26', hours: 20 },
    ];
    const row = hoursPage([metric(days)], TODAY).rows[0];
    expect(row.weeks).toHaveLength(12);
    expect(row.best).toBe(12);
    expect(row.streak).toBe(2);
    expect(row.weeksOnAim).toBe(2);
    // The last four full weeks hold 4 + 12 + 11 = 27 h over twenty weekdays.
    expect(row.perWeekday).toBe(1.35);
  });

  it('adds every metric into the total, and its aim when each has one', () => {
    const page = hoursPage(
      [
        metric([{ day: '2026-10-26', hours: 2 }]),
        metric([{ day: '2026-10-26', hours: 3 }], { id: 'm2', name: 'Cleaning', target: 10, targetHigh: 15 }),
      ],
      TODAY,
    );
    expect(page.total.week).toMatchObject({ hours: 5, expected: 12 });
    expect(page.total.grid[page.gridDays.indexOf('2026-10-26')]).toBe(5);
  });

  it('leaves time dated after today out', () => {
    const page = hoursPage([metric([{ day: '2026-10-30', hours: 5 }])], TODAY);
    expect(page.rows[0].week.hours).toBe(0);
  });

  it('has no pace without an aim', () => {
    const page = hoursPage([metric([], { target: null, targetHigh: null })], TODAY);
    expect(page.rows[0].week.pace).toBe('no aim');
    expect(page.rows[0].streak).toBeNull();
    expect(paceText(page.rows[0].week)).toBeNull();
  });
});

describe('words and shades', () => {
  it('names a range aim and a single one', () => {
    expect(aimText(10, 15)).toBe('10–15 h a week');
    expect(aimText(10, null)).toBe('10 h a week');
    expect(aimText(null, null)).toBeNull();
  });

  it('shades any time at all, in quarters of the top', () => {
    expect(shadeOf(0, 4)).toBe(0);
    expect(shadeOf(0.1, 4)).toBe(1);
    expect(shadeOf(2, 4)).toBe(2);
    expect(shadeOf(4, 4)).toBe(4);
  });
});
