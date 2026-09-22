import { describe, expect, it } from 'vitest';
import { notesLastRun, notesLastRunLine } from '@/lib/feedback/last-worked';

describe('notesLastRun', () => {
  it('says nothing when no note has been finished', () => {
    expect(notesLastRun([])).toBeNull();
  });

  it('counts the notes finished in the hours before the newest one', () => {
    const run = notesLastRun([
      { status: 'done', at: '2026-03-02T10:00:00Z' },
      { status: 'done', at: '2026-03-02T09:30:00Z' },
      { status: 'declined', at: '2026-03-02T09:10:00Z' },
      { status: 'blocked', at: '2026-03-02T09:45:00Z' },
      // The run before: more than three hours earlier.
      { status: 'done', at: '2026-03-02T06:00:00Z' },
    ]);
    expect(run).toEqual({
      at: '2026-03-02T10:00:00.000Z',
      done: 2,
      declined: 1,
      blocked: 1,
    });
  });

  it('skips a row with no usable time', () => {
    const run = notesLastRun([
      { status: 'done', at: 'not a date' },
      { status: 'blocked', at: '2026-03-02T10:00:00Z' },
    ]);
    expect(run).toMatchObject({ done: 0, blocked: 1 });
  });
});

describe('notesLastRunLine', () => {
  it('names only what happened', () => {
    expect(notesLastRunLine({ at: '', done: 4, declined: 0, blocked: 1 })).toBe(
      '4 fixed, 1 blocked',
    );
  });
});
