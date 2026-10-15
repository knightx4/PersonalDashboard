import { describe, expect, it } from 'vitest';
import { dayStartIn, snoozeDay } from './snooze-days';

describe('snoozeDay', () => {
  it('means the next day by tomorrow', () => {
    expect(snoozeDay('tomorrow', '2026-10-12')).toBe('2026-10-13');
  });
  it('means the coming Monday by next week, a week on from a Monday', () => {
    expect(snoozeDay('next_week', '2026-10-14')).toBe('2026-10-19');
    expect(snoozeDay('next_week', '2026-10-12')).toBe('2026-10-19');
  });
  it('means the coming Saturday by this weekend, a week on from a Saturday', () => {
    expect(snoozeDay('weekend', '2026-10-14')).toBe('2026-10-17');
    expect(snoozeDay('weekend', '2026-10-17')).toBe('2026-10-24');
    expect(snoozeDay('weekend', '2026-10-18')).toBe('2026-10-24');
  });
  it('means the first of next month by next month, across a year', () => {
    expect(snoozeDay('next_month', '2026-10-14')).toBe('2026-11-01');
    expect(snoozeDay('next_month', '2026-12-31')).toBe('2027-01-01');
  });
  it('takes a picked day after today and refuses the rest', () => {
    expect(snoozeDay('2026-11-02', '2026-10-12')).toBe('2026-11-02');
    expect(snoozeDay('2026-10-12', '2026-10-12')).toBeNull();
    expect(snoozeDay('2026-02-30', '2026-10-12')).toBeNull();
    expect(snoozeDay('someday', '2026-10-12')).toBeNull();
  });
});

describe('dayStartIn', () => {
  it('is midnight in the zone, across daylight saving', () => {
    expect(dayStartIn('2026-10-13', 'Europe/London').toISOString()).toBe('2026-10-12T23:00:00.000Z');
    expect(dayStartIn('2026-12-01', 'Europe/London').toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(dayStartIn('2026-10-13', 'America/New_York').toISOString()).toBe('2026-10-13T04:00:00.000Z');
    expect(dayStartIn('2026-10-13', 'UTC').toISOString()).toBe('2026-10-13T00:00:00.000Z');
  });
});
