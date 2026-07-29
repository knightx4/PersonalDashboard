import { describe, expect, it } from 'vitest';
import {
  deadlineLabel,
  daysBetween,
  effectiveReturnWindowDays,
  isDueSoon,
  isOverdue,
} from '@/lib/returns/deadline';

describe('daysBetween', () => {
  it('counts calendar days', () => {
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14);
    expect(daysBetween('2026-03-15', '2026-03-01')).toBe(-14);
    expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0);
  });
});

describe('deadlineLabel', () => {
  it('describes overdue and upcoming windows', () => {
    expect(deadlineLabel(-3, '2026-03-01')).toBe('3 days overdue');
    expect(deadlineLabel(-1, '2026-03-01')).toBe('1 day overdue');
    expect(deadlineLabel(0, '2026-03-01')).toBe('Due today');
    expect(deadlineLabel(1, '2026-03-01')).toBe('1 day left');
    expect(deadlineLabel(5, '2026-03-01')).toBe('5 days left');
    expect(deadlineLabel(20, '2026-03-21')).toBe('Until 2026-03-21');
  });
});

describe('due soon / overdue', () => {
  it('treats 0–14 days as due soon', () => {
    expect(isDueSoon(0)).toBe(true);
    expect(isDueSoon(14)).toBe(true);
    expect(isDueSoon(15)).toBe(false);
    expect(isDueSoon(-1)).toBe(false);
  });

  it('treats negative days as overdue', () => {
    expect(isOverdue(-1)).toBe(true);
    expect(isOverdue(0)).toBe(false);
  });
});

describe('effectiveReturnWindowDays', () => {
  it('prefers an override row, including null days', () => {
    expect(
      effectiveReturnWindowDays({
        seededDays: 30,
        override: { returnWindowDays: 14 },
      }),
    ).toBe(14);
    expect(
      effectiveReturnWindowDays({
        seededDays: 30,
        override: { returnWindowDays: null },
      }),
    ).toBeNull();
    expect(
      effectiveReturnWindowDays({
        seededDays: 30,
        override: null,
      }),
    ).toBe(30);
  });
});
