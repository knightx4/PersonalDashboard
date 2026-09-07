import { describe, expect, it } from 'vitest';
import { formatInterviewWhen } from './load';

/**
 * A round can be on the calendar with an hour, agreed for a day whose hour is
 * still being settled, or agreed with no date at all. The third state used to
 * be unreachable — the add form demanded a datetime — and the first two were
 * printed the same way, so a day-only round claimed to start at midnight.
 */
describe('formatInterviewWhen', () => {
  it('gives the hour when the hour is known', () => {
    expect(formatInterviewWhen('2026-09-15T14:30:00.000Z', true, 'UTC')).toBe(
      '15 Sept, 14:30 UTC',
    );
  });

  it('gives the day alone when only the day is settled', () => {
    expect(formatInterviewWhen('2026-09-15T00:00:00.000Z', false, 'UTC')).toBe('15 Sept 2026');
  });

  it('says the date is still to come rather than showing a dash', () => {
    expect(formatInterviewWhen(null, true, 'UTC')).toBe('Date to be set');
    expect(formatInterviewWhen(null, false, 'UTC')).toBe('Date to be set');
  });
});
