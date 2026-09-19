import { describe, expect, it } from 'vitest';
import { commentWhen, exactTime, shortWhen } from './when';

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

describe('shortWhen', () => {
  it('takes the same steps as commentWhen, without the words', () => {
    expect(shortWhen(at(20_000), NOW)).toBe('now');
    expect(shortWhen(at(60_000), NOW)).toBe('1m');
    expect(shortWhen(at(12 * 60_000), NOW)).toBe('12m');
    expect(shortWhen(at(59 * 60_000), NOW)).toBe('59m');
    expect(shortWhen(at(60 * 60_000), NOW)).toBe('1h');
    expect(shortWhen(at(3 * 60 * 60_000), NOW)).toBe('3h');
    expect(shortWhen(at(23 * 60 * 60_000), NOW)).toBe('23h');
    expect(shortWhen(at(24 * 60 * 60_000), NOW)).toBe('1d');
    expect(shortWhen(at(6 * 24 * 60 * 60_000), NOW)).toBe('6d');
  });

  it('becomes a day and a month on the seventh day', () => {
    expect(shortWhen(at(7 * 24 * 60 * 60_000), NOW)).toBe('6 Sep');
    expect(shortWhen('2026-08-30T09:15:00Z', NOW)).toBe('30 Aug');
  });

  it('leaves the year off a comment from an earlier one', () => {
    expect(shortWhen('2025-12-24T09:15:00Z', NOW)).toBe('24 Dec');
  });

  it('draws the date before the clock has been read', () => {
    expect(shortWhen('2026-09-13T11:00:00Z', 0)).toBe('13 Sep');
  });

  it('never counts forward', () => {
    expect(shortWhen(at(-4000), NOW)).toBe('now');
  });
});
