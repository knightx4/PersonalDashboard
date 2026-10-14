import { describe, expect, it } from 'vitest';
import {
  formatClock,
  hasTime,
  hourLabel,
  whenAgo,
  whenAt,
  whenDate,
  whenDay,
  whenDayKey,
  whenHour,
  whenOffset,
  whenRange,
  whenSpan,
  whenTime,
  whenWeekday,
  whenZoneName,
} from './when';

// Wednesday 14 October 2026, 15:05 in New York (19:05 UTC).
const NOW = '2026-10-14T19:05:00Z';
const ny = { timeZone: 'America/New_York', now: NOW };

/** The expected text with its spaces before AM and PM made no-break, as the helper writes them. */
const nb = (text: string) => text.replace(/ (AM|PM)/g, ' $1');

describe('formatClock', () => {
  it('reads an afternoon on the twelve-hour clock, with PM', () => {
    expect(formatClock('2026-09-28T15:05:00Z', { timeZone: 'UTC' })).toBe(nb('3:05 PM'));
  });

  it('reads midnight and noon as 12', () => {
    expect(formatClock('2026-09-28T00:00:00Z', { timeZone: 'UTC' })).toBe(nb('12:00 AM'));
    expect(formatClock('2026-09-28T12:30:00Z', { timeZone: 'UTC' })).toBe(nb('12:30 PM'));
  });

  it('keeps the date parts it is asked for, in their own order', () => {
    expect(
      formatClock('2026-09-28T09:15:00Z', { timeZone: 'UTC', day: 'numeric', month: 'short' }),
    ).toMatch(/^28 Sept?, 9:15 AM$/);
  });

  it('reads the clock in the zone it is given', () => {
    expect(formatClock('2026-09-28T15:05:00Z', { timeZone: 'America/New_York' })).toBe(
      nb('11:05 AM'),
    );
  });
});

describe('hourLabel', () => {
  it('labels the hours around the day', () => {
    expect([0, 9, 12, 15, 23].map(hourLabel)).toEqual(
      ['12 AM', '9 AM', '12 PM', '3 PM', '11 PM'].map(nb),
    );
  });
});

describe('whenDay', () => {
  it('names today, tomorrow and yesterday', () => {
    expect(whenDay('2026-10-14T12:00:00Z', ny)).toBe('Today');
    expect(whenDay('2026-10-15T12:00:00Z', ny)).toBe('Tomorrow');
    expect(whenDay('2026-10-13T12:00:00Z', ny)).toBe('Yesterday');
  });

  it('reads the day in the account zone, not UTC', () => {
    // 02:00 UTC on the 15th is still the evening of the 14th in New York.
    expect(whenDay('2026-10-15T02:00:00Z', ny)).toBe('Today');
    expect(whenDay('2026-10-15T02:00:00Z', { timeZone: 'UTC', now: NOW })).toBe('Tomorrow');
  });

  it('names the weekday up to six days either side, and the date after', () => {
    expect(whenDay('2026-10-16', ny)).toBe('Friday');
    expect(whenDay('2026-10-20', ny)).toBe('Tuesday');
    expect(whenDay('2026-10-21', ny)).toBe('21 Oct');
    expect(whenDay('2026-10-08', ny)).toBe('Thursday');
    expect(whenDay('2026-10-07', ny)).toBe('7 Oct');
  });

  it('adds the year only when it is not this year', () => {
    expect(whenDay('2026-12-31', ny)).toBe('31 Dec');
    expect(whenDay('2027-01-02', ny)).toBe('2 Jan 2027');
    expect(whenDay('2025-12-31', ny)).toBe('31 Dec 2025');
  });

  it('crosses a year boundary when today is New Year', () => {
    const jan = { timeZone: 'UTC', now: '2027-01-01T10:00:00Z' };
    expect(whenDay('2026-12-31', jan)).toBe('Yesterday');
    expect(whenDay('2026-12-26', jan)).toBe('Saturday');
    expect(whenDay('2026-12-25', jan)).toBe('25 Dec 2026');
  });
});

describe('whenTime', () => {
  it('has no seconds and no leading zero', () => {
    expect(whenTime('2026-10-14T09:05:30Z', { timeZone: 'UTC' })).toBe(nb('9:05 AM'));
  });

  it('reads the account zone', () => {
    expect(whenTime(NOW, { timeZone: 'America/New_York' })).toBe(nb('3:05 PM'));
  });
});

describe('whenAt', () => {
  it('puts the time after a day that has one', () => {
    expect(whenAt('2026-10-15T19:05:00Z', ny)).toBe(nb('Tomorrow, 3:05 PM'));
  });

  it('never shows a time beside a day given without one', () => {
    expect(whenAt('2026-10-15', ny)).toBe('Tomorrow');
    expect(hasTime('2026-10-15')).toBe(false);
    expect(hasTime('2026-10-15T00:00:00Z')).toBe(true);
  });
});

describe('whenSpan', () => {
  it('writes hours and minutes, then days', () => {
    expect(whenSpan(30_000)).toBe('under 1 min');
    expect(whenSpan(45 * 60_000)).toBe('45 min');
    expect(whenSpan(2 * 3_600_000)).toBe('2 h');
    expect(whenSpan(130 * 60_000)).toBe('2 h 10 min');
    expect(whenSpan(23 * 3_600_000 + 59 * 60_000)).toBe('23 h 59 min');
    expect(whenSpan(24 * 3_600_000)).toBe('1 day');
    expect(whenSpan(3 * 86_400_000 + 5 * 3_600_000)).toBe('3 days');
  });

  it('writes a deadline compactly, and a passed one as ago', () => {
    expect(whenSpan(25 * 3_600_000, { style: 'deadline' })).toBe('in 1d 1h');
    expect(whenSpan(130 * 60_000, { style: 'deadline' })).toBe('in 2h 10m');
    expect(whenSpan(2 * 86_400_000, { style: 'deadline' })).toBe('in 2d');
    expect(whenSpan(10_000, { style: 'deadline' })).toBe('in under 1m');
    expect(whenSpan(-65 * 60_000, { style: 'deadline' })).toBe('1h 5m ago');
  });
});

describe('whenAgo', () => {
  it('counts minutes and hours within the day', () => {
    expect(whenAgo('2026-10-14T19:04:40Z', ny)).toBe('just now');
    expect(whenAgo('2026-10-14T19:02:00Z', ny)).toBe('3 min ago');
    expect(whenAgo('2026-10-14T16:00:00Z', ny)).toBe('3 h ago');
  });

  it('says yesterday by calendar day, not by 24 hours', () => {
    // 90 minutes ago in elapsed time, but on yesterday's date in New York.
    expect(
      whenAgo('2026-10-14T03:30:00Z', { timeZone: 'America/New_York', now: '2026-10-14T05:00:00Z' }),
    ).toBe('yesterday');
  });

  it('falls to a weekday and then a date', () => {
    expect(whenAgo('2026-10-11T12:00:00Z', ny)).toBe('Sunday');
    expect(whenAgo('2026-10-01T12:00:00Z', ny)).toBe('1 Oct');
  });

  it('reads a moment ahead as its day', () => {
    expect(whenAgo('2026-10-15T19:05:00Z', ny)).toBe('Tomorrow');
  });
});

// -- calendar parts, dates kept as dates, ranges (plan #1957.5) --------------

describe('whenDayKey', () => {
  it('gives the day in the zone, and a bare date back as it is', () => {
    expect(whenDayKey('2026-10-15T02:00:00Z', ny)).toBe('2026-10-14');
    expect(whenDayKey('2026-10-15T02:00:00Z', { timeZone: 'UTC' })).toBe('2026-10-15');
    expect(whenDayKey('2026-03-05', ny)).toBe('2026-03-05');
  });
});

describe('whenHour', () => {
  it('reads the hour on a 24-hour clock in the zone', () => {
    expect(whenHour(NOW, ny)).toBe(15);
    expect(whenHour('2026-10-14T04:30:00Z', ny)).toBe(0);
    expect(whenHour(NOW, { timeZone: 'UTC' })).toBe(19);
  });
});

describe('whenWeekday', () => {
  it('names the weekday, long or short', () => {
    expect(whenWeekday('2026-10-14', ny)).toBe('Wednesday');
    expect(whenWeekday('2026-10-15T02:00:00Z', { ...ny, style: 'short' })).toBe('Wed');
  });
});

describe('whenDate', () => {
  it('keeps the date, with the year only when it is not this year', () => {
    expect(whenDate('2026-10-14', ny)).toBe('14 Oct');
    expect(whenDate('2025-10-14', ny)).toBe('14 Oct 2025');
    expect(whenDate('2026-10-14', { ...ny, year: 'always' })).toBe('14 Oct 2026');
    expect(whenDate('2025-10-14', { ...ny, year: 'never' })).toBe('14 Oct');
  });

  it('writes long months and a weekday before the date', () => {
    expect(whenDate('2026-10-04', { ...ny, weekday: 'long', month: 'long' })).toBe('Sunday 4 October');
    expect(whenDate('2026-10-04', { ...ny, weekday: 'short' })).toBe('Sun 4 Oct');
  });

  it('reads an instant on its day in the zone', () => {
    expect(whenDate('2026-10-15T02:00:00Z', ny)).toBe('14 Oct');
  });
});

describe('whenRange', () => {
  it('says the month and year once', () => {
    expect(whenRange('2026-09-20', '2026-09-26', { ...ny, month: 'long', year: 'always' })).toBe(
      '20 to 26 September 2026',
    );
    expect(whenRange('2026-09-27', '2026-10-03', ny)).toBe('27 Sep to 3 Oct');
    expect(whenRange('2025-12-28', '2026-01-03', ny)).toBe('28 Dec 2025 to 3 Jan 2026');
    expect(whenRange('2026-10-04', '2026-10-04', ny)).toBe('4 Oct');
  });
});

describe('whenZoneName and whenOffset', () => {
  it('name the zone and its offset at that moment', () => {
    expect(whenZoneName(NOW, ny)).toBe('EDT');
    expect(whenOffset(NOW, ny)).toBe(-4 * 3_600_000);
    expect(whenOffset('2026-12-14T19:05:00Z', ny)).toBe(-5 * 3_600_000);
    expect(whenOffset(NOW, { timeZone: 'UTC' })).toBe(0);
  });
});
