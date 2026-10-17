import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('./piece-store', () => ({
  loadPiecePage: async (_l: unknown, _u: string, subjectId: string, pieceId: string) => ({
    subjectId,
    piece: { id: pieceId, title: 'A piece' },
    ideas: [{ id: 'i1' }],
  }),
}));

import { loadTodaysPiece } from './todays-piece-store';
import { planEntries } from './plan-store';

/**
 * A prepared subject with no goal supplies today's piece (plan #2292.4). The
 * client answers each table with fixed rows and ignores filters, which is
 * enough: only one person's rows are in it.
 */
const tables: Record<string, unknown[]> = {
  aims: [],
  subject_preparations: [{ subject_id: 's-prepared' }],
  subjects: [{ id: 's-prepared', name: 'Music theory' }],
  curriculum_units: [{ id: 'u1', subject_id: 's-prepared', ordinal: 1 }],
  plan_pieces: [{ id: 'p1', unit_id: 'u1', ordinal: 1, passed_at: null }],
  piece_checks: [],
};

function query(rows: unknown[]) {
  const q: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
  };
  for (const method of ['select', 'eq', 'is', 'not', 'in', 'order']) q[method] = () => q;
  return q;
}
const learn = { from: (table: string) => query(tables[table] ?? []) } as never;

describe('a prepared subject with no goal', () => {
  it('is a plan entry named for the subject, with no goal', async () => {
    expect(await planEntries(learn, 'u')).toEqual([{ aimId: null, name: 'Music theory', subjectId: 's-prepared' }]);
  });

  it('supplies today’s piece', async () => {
    const piece = await loadTodaysPiece(learn, 'u');
    expect(piece).toMatchObject({ kind: 'piece', goalName: 'Music theory' });
    expect(piece && piece.kind === 'piece' && piece.page.piece.id).toBe('p1');
  });
});
