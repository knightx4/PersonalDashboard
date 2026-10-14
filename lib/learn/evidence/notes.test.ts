import { describe, expect, it } from 'vitest';

import {
  CLIPPING_WEIGHT,
  NOTES_PER_IDEA,
  noteBasis,
  noteLinkRows,
  noteWeight,
  staleLinkIds,
  type NoteMatch,
} from './notes';

const ARRIVED = '2026-09-01T10:00:00.000Z';

function match(overrides: Partial<NoteMatch> = {}): NoteMatch {
  return {
    concept_id: 'idea-1',
    note_id: 'note-1',
    path: 'Yale/MGT 541/Discount rates.md',
    title: 'Discount rates',
    similarity: 0.7,
    created_at: ARRIVED,
    written_at: ARRIVED,
    ...overrides,
  };
}

describe('noteWeight', () => {
  it('counts your own writing fully', () => {
    expect(noteWeight(match({ path: 'Yale/MGT 541/Discount rates.md' }))).toBe(1);
    expect(noteWeight(match({ path: 'Career/EY/Audit work.md' }))).toBe(1);
    expect(noteWeight(match({ path: 'Me/Values.md' }))).toBe(1);
  });

  it('counts a clipping in Bulk or Pending a quarter', () => {
    expect(CLIPPING_WEIGHT).toBe(0.25);
    expect(noteWeight(match({ path: 'Bulk/Resources/Books/Utopia for Realists.md' }))).toBe(0.25);
    expect(noteWeight(match({ path: 'Pending/South Sea Bubble.md' }))).toBe(0.25);
    expect(noteWeight(match({ path: 'pending/lower case.md' }))).toBe(0.25);
  });

  it('counts a clipping you wrote into fully', () => {
    const edited = match({ path: 'Pending/South Sea Bubble.md', written_at: '2026-09-20T08:00:00.000Z' });
    expect(noteWeight(edited)).toBe(1);
  });

  it('does not read a stamp within the minute it arrived as an edit', () => {
    const sameSync = match({ path: 'Bulk/Niche.md', written_at: '2026-09-01T10:00:30.000Z' });
    expect(noteWeight(sameSync)).toBe(CLIPPING_WEIGHT);
  });

  it('does not treat a top-level file named like the folder as a clipping', () => {
    expect(noteWeight(match({ path: 'Pending.md' }))).toBe(1);
  });
});

describe('noteBasis', () => {
  it('names the note', () => {
    expect(noteBasis(match())).toBe('you wrote about this in Discount rates');
  });

  it('falls back to the file name', () => {
    expect(noteBasis(match({ title: '  ', path: 'Me/On risk.md' }))).toBe('you wrote about this in On risk');
  });
});

describe('noteLinkRows', () => {
  it('keeps the five closest notes per idea at 0.6 or above, with folder weights', () => {
    const matches = [
      ...Array.from({ length: 7 }, (_, i) =>
        match({ note_id: `note-${i}`, similarity: 0.6 + i * 0.01, path: i % 2 ? 'Bulk/x.md' : 'Me/x.md' }),
      ),
      match({ note_id: 'too-far', similarity: 0.59 }),
      match({ concept_id: 'idea-2', note_id: 'clip', path: 'Pending/Wealth of Nations.md' }),
    ];
    const rows = noteLinkRows('user-1', matches);

    const first = rows.filter((row) => row.target_id === 'idea-1');
    expect(first).toHaveLength(NOTES_PER_IDEA);
    expect(first.map((row) => row.source_id)).toEqual(['note-6', 'note-5', 'note-4', 'note-3', 'note-2']);
    expect(first.map((row) => row.weight)).toEqual([1, 0.25, 1, 0.25, 1]);

    const second = rows.filter((row) => row.target_id === 'idea-2');
    expect(second).toEqual([
      {
        user_id: 'user-1',
        target_kind: 'idea',
        target_id: 'idea-2',
        source_kind: 'note',
        source_id: 'clip',
        similarity: 0.7,
        weight: CLIPPING_WEIGHT,
        basis: 'you wrote about this in Discount rates',
      },
    ]);
  });
});

describe('staleLinkIds', () => {
  it('returns links whose note no longer matches the idea', () => {
    const existing = [
      { id: 'a', target_id: 'idea-1', source_id: 'note-1' },
      { id: 'b', target_id: 'idea-1', source_id: 'note-2' },
      { id: 'c', target_id: 'idea-2', source_id: 'note-1' },
    ];
    const fresh = [
      { target_id: 'idea-1', source_id: 'note-1' },
      { target_id: 'idea-2', source_id: 'note-9' },
    ];
    expect(staleLinkIds(existing, fresh)).toEqual(['b', 'c']);
  });
});
