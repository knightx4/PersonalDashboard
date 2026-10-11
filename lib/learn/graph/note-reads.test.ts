import { describe, expect, it } from 'vitest';
import { summariseNoteReads } from './note-reads';

const row = (proposed: number, kept: number, weak: number, approved: number | null) => ({
  proposed,
  kept,
  weak,
  approved_at: approved === null ? null : '2026-10-11T00:00:00Z',
  approved_count: approved,
});

describe('summariseNoteReads', () => {
  it('gives concepts per note and the approved share', () => {
    const s = summariseNoteReads([row(4, 2, 1, 3), row(3, 0, 0, null), row(2, 1, 0, null)]);
    expect(s.reads).toBe(3);
    expect(s.shown).toBe(4);
    expect(s.perNote).toBeCloseTo(4 / 3);
    expect(s.proposedPerNote).toBe(3);
    expect(s.empty).toBe(1);
    expect(s.approvedShare).toBe(0.75);
  });

  it('has no share when nothing was shown, and no division by zero when empty', () => {
    expect(summariseNoteReads([row(2, 0, 0, null)]).approvedShare).toBeNull();
    expect(summariseNoteReads([]).perNote).toBe(0);
  });
});
