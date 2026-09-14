import { describe, expect, it } from 'vitest';
import { commentWhen, exactTime } from './when';

const NOW = Date.parse('2026-09-13T12:00:00Z');
const at = (ms: number) => new Date(NOW - ms).toISOString();

describe('commentWhen', () => {
  it('counts in the coarsest unit that still says it', () => {
    expect(commentWhen(at(20_000), NOW)).toBe('just now');
    expect(commentWhen(at(12 * 60_000), NOW)).toBe('12m ago');
    expect(commentWhen(at(3 * 60 * 60_000), NOW)).toBe('3h ago');
    expect(commentWhen(at(2 * 24 * 60 * 60_000), NOW)).toBe('2d ago');
  });

  it('becomes the date once nobody is counting days', () => {
    expect(commentWhen('2026-08-30T09:15:00Z', NOW)).toBe('2026-08-30');
    expect(commentWhen(at(8 * 24 * 60 * 60_000), NOW)).toBe('2026-09-05');
  });

  it('draws the date before the clock has been read', () => {
    expect(commentWhen('2026-09-13T11:00:00Z', 0)).toBe('2026-09-13');
  });

  it('never counts forward', () => {
    expect(commentWhen(at(-4000), NOW)).toBe('just now');
  });
});

describe('exactTime', () => {
  it('keeps the minute, as stored', () => {
    expect(exactTime('2026-09-13T11:42:07.581Z')).toBe('2026-09-13 11:42');
  });
});
