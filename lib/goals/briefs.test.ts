import { describe, expect, it } from 'vitest';
import { briefIsStale, writtenWhen } from './briefs';

const NOW = Date.parse('2026-09-26T15:00:00Z');

describe('writtenWhen', () => {
  it('says today for a note written on the account’s own today', () => {
    expect(writtenWhen({ createdAt: '2026-09-26T09:00:00Z' }, 'UTC', NOW)).toBe('today');
  });

  it('reads the day in the account’s zone, not in UTC', () => {
    // 01:00 UTC on the 26th is still the 25th in New York, and so is "now" at 03:00 UTC.
    const lateEvening = '2026-09-26T01:00:00Z';
    expect(writtenWhen({ createdAt: lateEvening }, 'America/New_York', Date.parse('2026-09-26T03:00:00Z'))).toBe(
      'today',
    );
    expect(writtenWhen({ createdAt: lateEvening }, 'America/New_York', NOW)).toBe('on 25 Sept');
  });

  it('says how old a note over a week old is', () => {
    const old = { createdAt: '2026-09-10T09:00:00Z' };
    expect(briefIsStale(old, NOW)).toBe(true);
    expect(writtenWhen(old, 'UTC', NOW)).toBe('on 10 Sept, over a week ago');
  });
});
