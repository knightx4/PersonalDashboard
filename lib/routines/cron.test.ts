import { describe, expect, it } from 'vitest';
import { describeCron, nextFire, parseCron } from './cron';

// Saturday 10 October 2026, 03:45 UTC.
const NOW = Date.UTC(2026, 9, 10, 3, 45);

describe('parseCron', () => {
  it('reads steps, ranges and lists', () => {
    const cron = parseCron('3-59/10 1,7 * * 1-5')!;
    expect([...cron.minute]).toEqual([3, 13, 23, 33, 43, 53]);
    expect([...cron.hour]).toEqual([1, 7]);
    expect([...cron.dayOfWeek]).toEqual([1, 2, 3, 4, 5]);
  });

  it('refuses what it cannot read', () => {
    expect(parseCron('@daily')).toBeNull();
    expect(parseCron('61 * * * *')).toBeNull();
    expect(parseCron('* * * *')).toBeNull();
  });
});

describe('nextFire', () => {
  it('finds the next weekly fire', () => {
    expect(nextFire('41 14 * * 0', NOW)).toBe('2026-10-11T14:41:00.000Z');
  });

  it('finds the next fire later the same hour', () => {
    expect(nextFire('3-59/10 * * * *', NOW)).toBe('2026-10-10T03:53:00.000Z');
  });

  it('moves past the current minute', () => {
    expect(nextFire('45 3 * * *', NOW)).toBe('2026-10-11T03:45:00.000Z');
  });

  it('finds a yearly fire', () => {
    expect(nextFire('23 15 2 1 *', NOW)).toBe('2027-01-02T15:23:00.000Z');
  });

  it('is null for what it cannot read', () => {
    expect(nextFire('nonsense', NOW)).toBeNull();
  });
});

describe('describeCron', () => {
  it.each([
    ['*/4 * * * *', 'Every 4 minutes'],
    ['3-59/10 * * * *', 'Every 10 minutes'],
    ['41 * * * *', 'Every hour'],
    ['35 14 * * *', 'Every day'],
    ['53 1,7,13,19 * * *', '4 times a day'],
    ['41 14 * * 0', 'Every week'],
    ['0 9 1 * *', 'Every month'],
    ['23 15 2 1 *', 'Once a year'],
    ['nonsense', 'nonsense'],
  ])('%s reads as %s', (expression, words) => {
    expect(describeCron(expression)).toBe(words);
  });
});
