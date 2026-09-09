import { describe, expect, it } from 'vitest';
import { elapsedSince } from './elapsed';

const start = '2026-09-09T10:00:00.000Z';
const at = (minutes: number) => new Date(start).getTime() + minutes * 60_000;

describe('elapsedSince', () => {
  it('says "just now" under a minute', () => {
    expect(elapsedSince(start, at(0))).toBe('just now');
    expect(elapsedSince(start, at(0.9))).toBe('just now');
  });

  it('counts whole minutes under the hour', () => {
    expect(elapsedSince(start, at(1))).toBe('1m');
    expect(elapsedSince(start, at(59))).toBe('59m');
  });

  it('drops to hours and minutes past the hour', () => {
    expect(elapsedSince(start, at(60))).toBe('1h');
    expect(elapsedSince(start, at(160))).toBe('2h 40m');
    expect(elapsedSince(start, at(60 * 23 + 59))).toBe('23h 59m');
  });

  it('drops to days and hours past the day', () => {
    expect(elapsedSince(start, at(60 * 24))).toBe('1d');
    expect(elapsedSince(start, at(60 * 30))).toBe('1d 6h');
    expect(elapsedSince(start, at(60 * 24 * 3))).toBe('3d');
  });

  // A browser clock a little behind the server's is ordinary, and a step that
  // reads as started in the future must not read as negative.
  it('never goes backwards', () => {
    expect(elapsedSince(start, at(-5))).toBe('just now');
  });
});
