import { describe, expect, it } from 'vitest';
import { formatClock, hourLabel } from './clock';

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
