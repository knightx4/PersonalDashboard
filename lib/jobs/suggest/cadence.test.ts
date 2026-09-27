import { describe, expect, it } from 'vitest';
import { suggestionDue } from './cadence';

const NOW = new Date('2026-09-27T13:47:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe('suggestionDue', () => {
  it('runs the first time', () => {
    expect(suggestionDue('reach_out', { lastRunAt: null, open: 0 }, NOW)).toBe(true);
  });

  it('writes people every three days, tolerating a cron a few minutes early', () => {
    expect(suggestionDue('reach_out', { lastRunAt: daysAgo(2), open: 0 }, NOW)).toBe(false);
    expect(suggestionDue('reach_out', { lastRunAt: daysAgo(2.99), open: 0 }, NOW)).toBe(true);
  });

  it('adds nothing while three people are still open', () => {
    expect(suggestionDue('reach_out', { lastRunAt: daysAgo(10), open: 3 }, NOW)).toBe(false);
  });

  it('searches for postings once a week', () => {
    expect(suggestionDue('apply', { lastRunAt: daysAgo(5), open: 0 }, NOW)).toBe(false);
    expect(suggestionDue('apply', { lastRunAt: daysAgo(7), open: 2 }, NOW)).toBe(true);
  });
});
