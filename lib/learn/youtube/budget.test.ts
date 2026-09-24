import { describe, expect, it } from 'vitest';
import {
  MAX_PER_SCHEDULED_RUN,
  creditState,
  monthStart,
  monthlyAllowance,
  nextMonthStart,
  projectedMonthEnd,
  scheduledRunAllowance,
  scheduledRunsLeft,
} from '@/lib/learn/youtube/budget';

describe('monthlyAllowance', () => {
  it('defaults to the plan and takes a raised number', () => {
    expect(monthlyAllowance(undefined)).toBe(1000);
    expect(monthlyAllowance('')).toBe(1000);
    expect(monthlyAllowance('2000')).toBe(2000);
    expect(monthlyAllowance(' 0 ')).toBe(0);
  });

  it('ignores a value that is not a count', () => {
    expect(monthlyAllowance('lots')).toBe(1000);
    expect(monthlyAllowance('-5')).toBe(1000);
  });
});

describe('month boundaries', () => {
  it('are calendar months in UTC', () => {
    const now = new Date('2026-09-24T03:00:00Z');
    expect(monthStart(now).toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(nextMonthStart(now).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(nextMonthStart(new Date('2026-12-31T23:00:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('creditState', () => {
  it('never reports less than nothing left', () => {
    const now = new Date('2026-09-24T00:00:00Z');
    expect(creditState(312, 1000, now).remaining).toBe(688);
    expect(creditState(1004, 1000, now).remaining).toBe(0);
  });
});

describe('scheduledRunsLeft', () => {
  it('counts the runs to the end of the month, this one included', () => {
    // Six days and twenty-one hours to go at four runs a day.
    expect(scheduledRunsLeft(new Date('2026-09-24T03:00:00Z'))).toBe(28);
    expect(scheduledRunsLeft(new Date('2026-09-30T23:59:00Z'))).toBe(1);
  });
});

describe('scheduledRunAllowance', () => {
  it('spreads what is left across the runs left', () => {
    const now = new Date('2026-09-24T03:00:00Z');
    // 688 over 28 runs is 24.6, rounded up.
    expect(scheduledRunAllowance(creditState(312, 1000, now), now)).toBe(25);
  });

  it('spends nothing once the allowance is gone', () => {
    const now = new Date('2026-09-24T03:00:00Z');
    expect(scheduledRunAllowance(creditState(1000, 1000, now), now)).toBe(0);
  });

  it('never takes more than one run has time for', () => {
    const now = new Date('2026-09-30T23:00:00Z');
    expect(scheduledRunAllowance(creditState(0, 1000, now), now)).toBe(MAX_PER_SCHEDULED_RUN);
  });
});

describe('projectedMonthEnd', () => {
  it('carries the rate so far to the end of the month', () => {
    // 300 credits in 15 of 30 days.
    const now = new Date('2026-09-16T00:00:00Z');
    expect(projectedMonthEnd(creditState(300, 1000, now), now)).toBe(600);
  });

  it('says nothing on the first day', () => {
    const now = new Date('2026-09-01T12:00:00Z');
    expect(projectedMonthEnd(creditState(40, 1000, now), now)).toBeNull();
  });
});
