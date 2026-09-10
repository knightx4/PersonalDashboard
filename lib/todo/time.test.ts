import { describe, expect, it } from 'vitest';
import { wallClockToInstant } from '@/lib/todo/time';

describe('wallClockToInstant', () => {
  it('reads a wall clock in the given zone', () => {
    expect(wallClockToInstant('2026-06-01', '09:00', 'UTC')).toBe('2026-06-01T09:00:00.000Z');
    expect(wallClockToInstant('2026-06-01', '09:00', 'Asia/Tokyo')).toBe('2026-06-01T00:00:00.000Z');
    expect(wallClockToInstant('2026-06-01', '09:00', 'America/Los_Angeles')).toBe(
      '2026-06-01T16:00:00.000Z',
    );
  });

  it('gets the right side of a daylight saving change', () => {
    // London goes forward at 01:00 on 2026-03-29. A single-pass offset
    // measurement lands on the wrong side of the change and comes out an hour
    // early, which is the reason the measurement is taken twice.
    expect(wallClockToInstant('2026-03-28', '12:00', 'Europe/London')).toBe(
      '2026-03-28T12:00:00.000Z',
    );
    expect(wallClockToInstant('2026-03-30', '12:00', 'Europe/London')).toBe(
      '2026-03-30T11:00:00.000Z',
    );
  });

  it('handles a zone on a half-hour offset', () => {
    expect(wallClockToInstant('2026-06-01', '09:00', 'Asia/Kolkata')).toBe(
      '2026-06-01T03:30:00.000Z',
    );
  });
});
