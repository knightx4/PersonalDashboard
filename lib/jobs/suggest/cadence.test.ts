import { describe, expect, it } from 'vitest';
import { cadenceState, suggestionDue } from './cadence';

const NOW = new Date('2026-09-27T13:47:00Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const state = (lastRunAt: string | null, open: number, emptied = false) => ({ lastRunAt, open, emptied });

describe('suggestionDue', () => {
  it('runs the first time', () => {
    expect(suggestionDue('reach_out', state(null, 0), NOW)).toBe(true);
  });

  it('writes people every three days, tolerating a cron a few minutes early', () => {
    expect(suggestionDue('reach_out', state(ago(2), 2), NOW)).toBe(false);
    expect(suggestionDue('reach_out', state(ago(2.99), 2), NOW)).toBe(true);
  });

  it('adds nothing while the list is full', () => {
    expect(suggestionDue('reach_out', state(ago(10), 5), NOW)).toBe(false);
    expect(suggestionDue('apply', state(ago(10), 30), NOW)).toBe(false);
  });

  it('keeps searching for roles until thirty of its own are open', () => {
    expect(suggestionDue('apply', state(ago(10), 8), NOW)).toBe(true);
    expect(suggestionDue('apply', state(ago(10), 29), NOW)).toBe(true);
  });

  it('searches for roles once a week', () => {
    expect(suggestionDue('apply', state(ago(5), 2), NOW)).toBe(false);
    expect(suggestionDue('apply', state(ago(7), 2), NOW)).toBe(true);
  });

  it('refills an emptied list by the next daily run', () => {
    expect(suggestionDue('apply', state(ago(0.4), 0, true), NOW)).toBe(true);
    expect(suggestionDue('reach_out', state(ago(0.1), 0, true), NOW)).toBe(false);
  });

  it('leaves a list that is empty because nothing was found for the full interval', () => {
    expect(suggestionDue('reach_out', state(ago(1), 0, false), NOW)).toBe(false);
    expect(suggestionDue('apply', state(ago(5), 0, false), NOW)).toBe(false);
  });
});

describe('cadenceState', () => {
  it('reads a run that stored rows, all since turned down, as emptied', () => {
    expect(
      cadenceState(
        [
          { status: 'dismissed', createdAt: ago(0.4) },
          { status: 'done', createdAt: ago(0.4) },
        ],
        null,
      ),
    ).toEqual({ lastRunAt: ago(0.4), open: 0, emptied: true });
  });

  it('reads a later run that found nothing as the last run, and not emptied', () => {
    const run = ago(1);
    expect(cadenceState([{ status: 'dismissed', createdAt: ago(5) }], run)).toEqual({
      lastRunAt: run,
      open: 0,
      emptied: false,
    });
  });

  it('counts the open rows', () => {
    const rows = [
      { status: 'open', createdAt: ago(1) },
      { status: 'open', createdAt: ago(1) },
      { status: 'dismissed', createdAt: ago(1) },
    ];
    expect(cadenceState(rows, ago(1))).toMatchObject({ open: 2, emptied: false });
  });
});
