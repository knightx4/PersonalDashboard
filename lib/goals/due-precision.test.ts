import { describe, expect, it } from 'vitest';
import {
  formatDue,
  formatDueBy,
  isDueOverdue,
  isDuePrecision,
  isPeriodEnd,
  periodEnd,
  toDuePrecision,
} from '@/lib/goals/due-precision';

describe('periodEnd', () => {
  it('keeps a day', () => expect(periodEnd('2027-05-15', 'day')).toBe('2027-05-15'));
  it('ends a month, in a leap year too', () => {
    expect(periodEnd('2027-03-10', 'month')).toBe('2027-03-31');
    expect(periodEnd('2027-04-10', 'month')).toBe('2027-04-30');
    expect(periodEnd('2028-02-01', 'month')).toBe('2028-02-29');
    expect(periodEnd('2027-02-01', 'month')).toBe('2027-02-28');
  });
  it('ends a quarter', () => {
    expect(periodEnd('2027-01-01', 'quarter')).toBe('2027-03-31');
    expect(periodEnd('2027-05-15', 'quarter')).toBe('2027-06-30');
    expect(periodEnd('2027-09-30', 'quarter')).toBe('2027-09-30');
    expect(periodEnd('2027-11-02', 'quarter')).toBe('2027-12-31');
  });
  it('ends a half year', () => {
    expect(periodEnd('2027-06-30', 'half')).toBe('2027-06-30');
    expect(periodEnd('2027-07-01', 'half')).toBe('2027-12-31');
  });
  it('ends a year', () => expect(periodEnd('2027-02-03', 'year')).toBe('2027-12-31'));
  it('says whether a date is already an end', () => {
    expect(isPeriodEnd('2027-06-30', 'quarter')).toBe(true);
    expect(isPeriodEnd('2027-06-29', 'quarter')).toBe(false);
    expect(isPeriodEnd('2027-06-29', 'day')).toBe(true);
  });
});

describe('formatDue', () => {
  it('shows each precision', () => {
    expect(formatDue('2027-03-31', 'month')).toBe('Mar 2027');
    expect(formatDue('2027-06-30', 'quarter')).toBe('Q2 2027');
    expect(formatDue('2027-06-30', 'half')).toBe('H1 2027');
    expect(formatDue('2027-12-31', 'half')).toBe('H2 2027');
    expect(formatDue('2027-12-31', 'year')).toBe('2027');
  });
  it('shows a day with its year unless it is this year', () => {
    expect(formatDue('2026-10-03')).toBe('3 Oct 2026');
    expect(formatDue('2026-10-03', 'day', 2026)).toBe('3 Oct');
    expect(formatDue('2027-10-03', 'day', 2026)).toBe('3 Oct 2027');
  });
  it('adds by', () => {
    expect(formatDueBy('2027-03-31', 'month')).toBe('by Mar 2027');
    expect(formatDueBy('2027-06-30', 'quarter')).toBe('by Q2 2027');
    expect(formatDueBy('2027-12-31', 'year')).toBe('by 2027');
  });
});

describe('isDueOverdue', () => {
  it('is not overdue until the whole period has passed', () => {
    expect(isDueOverdue('2027-06-30', 'quarter', '2027-05-15')).toBe(false);
    expect(isDueOverdue('2027-06-30', 'quarter', '2027-06-30')).toBe(false);
    expect(isDueOverdue('2027-06-30', 'quarter', '2027-07-01')).toBe(true);
    expect(isDueOverdue('2027-12-31', 'year', '2027-12-31')).toBe(false);
    expect(isDueOverdue('2027-12-31', 'year', '2028-01-01')).toBe(true);
    expect(isDueOverdue('2027-03-31', 'month', '2027-04-01')).toBe(true);
    expect(isDueOverdue('2027-12-31', 'half', '2027-09-01')).toBe(false);
  });
  it('treats a day as before', () => {
    expect(isDueOverdue('2026-10-11', 'day', '2026-10-12')).toBe(true);
    expect(isDueOverdue('2026-10-12', 'day', '2026-10-12')).toBe(false);
  });
  it('never calls an undated goal overdue', () => {
    expect(isDueOverdue(null, 'day', '2030-01-01')).toBe(false);
  });
});

describe('precision values', () => {
  it('reads an unknown value as a day', () => {
    expect(toDuePrecision('quarter')).toBe('quarter');
    expect(toDuePrecision('week')).toBe('day');
    expect(toDuePrecision(null)).toBe('day');
    expect(isDuePrecision('half')).toBe(true);
  });
});
