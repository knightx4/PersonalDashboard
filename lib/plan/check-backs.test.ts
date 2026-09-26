import { describe, expect, it } from 'vitest';
import {
  chooseWake,
  dueWords,
  isDue,
  parseDelay,
  wakeDayStart,
  wakeTurn,
  WAKE_GRACE_MS,
  WAKES_PER_DAY,
  type CheckBack,
} from '@/lib/plan/check-backs';

const NOW = Date.parse('2026-09-26T04:00:00Z');

function row(overrides: Partial<CheckBack> = {}): CheckBack {
  return {
    id: 'cb-1',
    userId: 'u',
    title: 'See what the YouTube run queued',
    detail: null,
    dueAt: '2026-09-26T02:20:00Z',
    planItemId: null,
    source: null,
    wake: true,
    status: 'waiting',
    outcome: null,
    closedAt: null,
    wokeAt: null,
    createdAt: '2026-09-25T23:50:00Z',
    ...overrides,
  };
}

describe('parseDelay', () => {
  it('reads minutes, hours, days and mixes of them', () => {
    expect(parseDelay('90m')).toBe(90 * 60_000);
    expect(parseDelay('2h')).toBe(2 * 3_600_000);
    expect(parseDelay('1d')).toBe(86_400_000);
    expect(parseDelay(' 1h30m ')).toBe(90 * 60_000);
  });

  it('refuses anything else, nothing, and more than a month', () => {
    expect(parseDelay('')).toBeNull();
    expect(parseDelay('2 hours')).toBeNull();
    expect(parseDelay('h')).toBeNull();
    expect(parseDelay('0m')).toBeNull();
    expect(parseDelay('31d')).toBeNull();
  });
});

describe('isDue', () => {
  it('is due once the time has passed and it is still waiting', () => {
    expect(isDue(row(), NOW)).toBe(true);
    expect(isDue(row({ dueAt: '2026-09-26T05:00:00Z' }), NOW)).toBe(false);
    expect(isDue(row({ status: 'done' }), NOW)).toBe(false);
  });
});

describe('chooseWake', () => {
  it('wakes for a check-back an hour past due, oldest first', () => {
    const later = row({ id: 'cb-2', dueAt: '2026-09-26T02:50:00Z' });
    const earlier = row({ id: 'cb-1', dueAt: '2026-09-26T01:00:00Z' });
    expect(chooseWake([later, earlier], 0, NOW).map((r) => r.id)).toEqual(['cb-1', 'cb-2']);
  });

  it('leaves one inside the grace hour for a session that runs anyway', () => {
    const justDue = row({ dueAt: new Date(NOW - WAKE_GRACE_MS + 60_000).toISOString() });
    expect(chooseWake([justDue], 0, NOW)).toEqual([]);
  });

  it('never wakes twice, never for one that asked not to be, and not past the daily cap', () => {
    expect(chooseWake([row({ wokeAt: '2026-09-26T03:25:00Z' })], 0, NOW)).toEqual([]);
    expect(chooseWake([row({ wake: false })], 0, NOW)).toEqual([]);
    expect(chooseWake([row({ status: 'dropped' })], 0, NOW)).toEqual([]);
    expect(chooseWake([row()], WAKES_PER_DAY, NOW)).toEqual([]);
  });
});

describe('wakeDayStart', () => {
  it('is midnight UTC of the same day', () => {
    expect(new Date(wakeDayStart(NOW)).toISOString()).toBe('2026-09-26T00:00:00.000Z');
  });
});

describe('dueWords', () => {
  it('says how far ahead or behind', () => {
    expect(dueWords('2026-09-26T06:05:00Z', NOW)).toBe('in 2h 5m');
    expect(dueWords('2026-09-26T03:55:00Z', NOW)).toBe('5m ago');
    expect(dueWords('2026-09-28T05:00:00Z', NOW)).toBe('in 2d 1h');
    expect(dueWords('2026-09-26T04:00:20Z', NOW)).toBe('now');
  });
});

describe('wakeTurn', () => {
  it('names each check-back with its id and says how to close it', () => {
    const text = wakeTurn([row({ detail: 'Read videos_to_transcribe.', source: 'plan #1051' })]);
    expect(text).toContain('### See what the YouTube run queued');
    expect(text).toContain('id: cb-1');
    expect(text).toContain('from plan #1051');
    expect(text).toContain('Read videos_to_transcribe.');
    expect(text).toContain('plan.ts checked <id> --note');
  });
});
