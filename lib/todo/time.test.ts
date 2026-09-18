import { describe, expect, it } from 'vitest';
import { clockIn, dayIn, nextHourSlot, wallClockToInstant } from '@/lib/todo/time';

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

describe('nextHourSlot', () => {
  it('offers the next whole hour, an hour long', () => {
    expect(nextHourSlot(new Date('2026-03-10T14:20:00.000Z'), 'UTC')).toEqual({
      start: '15:00',
      end: '16:00',
    });
  });

  it('asks the reader s own clock, not UTC', () => {
    // 06:20 UTC is already twenty past three in the afternoon in Tokyo.
    expect(nextHourSlot(new Date('2026-03-10T06:20:00.000Z'), 'Asia/Tokyo')).toEqual({
      start: '16:00',
      end: '17:00',
    });
  });

  it('does not roll past the end of the day', () => {
    // 23:40 has no next hour left in it, and 00:00 to 01:00 would be an event
    // ending before it starts.
    expect(nextHourSlot(new Date('2026-03-10T23:40:00.000Z'), 'UTC')).toEqual({
      start: '23:00',
      end: '23:59',
    });
  });
});

describe('dayIn / clockIn', () => {
  // The pair exists so a date input opens on the day the label beside it
  // shows. In UTC the two readings agree and the test proves nothing.
  it('reads an instant in the given zone, not in UTC', () => {
    const lateUtc = '2026-03-10T23:30:00.000Z';

    expect(dayIn(lateUtc, 'UTC')).toBe('2026-03-10');
    expect(clockIn(lateUtc, 'UTC')).toBe('23:30');

    // Tokyo is nine hours ahead: already the next morning.
    expect(dayIn(lateUtc, 'Asia/Tokyo')).toBe('2026-03-11');
    expect(clockIn(lateUtc, 'Asia/Tokyo')).toBe('08:30');

    // New York is still the same evening. Four behind, not five: 10 March is
    // after the second Sunday, so the clocks have already gone forward -- which
    // is the case a fixed offset would get wrong.
    expect(dayIn(lateUtc, 'America/New_York')).toBe('2026-03-10');
    expect(clockIn(lateUtc, 'America/New_York')).toBe('19:30');
  });

  // A time input refuses "24:00", which is what some ICU builds return for
  // midnight under hour12: false.
  it('gives midnight as 00:00', () => {
    expect(clockIn('2026-03-10T00:00:00.000Z', 'UTC')).toBe('00:00');
  });

  it('pads a single-digit day, month, hour and minute', () => {
    expect(dayIn('2026-01-05T04:07:00.000Z', 'UTC')).toBe('2026-01-05');
    expect(clockIn('2026-01-05T04:07:00.000Z', 'UTC')).toBe('04:07');
  });

  // Round trip: what these two read out is what wallClockToInstant puts in.
  it('round-trips through wallClockToInstant', () => {
    const instant = wallClockToInstant('2026-07-04', '14:30', 'America/New_York');

    expect(dayIn(instant, 'America/New_York')).toBe('2026-07-04');
    expect(clockIn(instant, 'America/New_York')).toBe('14:30');
  });
});
