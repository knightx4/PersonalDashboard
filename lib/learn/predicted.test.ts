import { describe, expect, it, vi } from 'vitest';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadGradeMap } from '@/lib/learn/levels/loader-grade';
import { predictedCell, predictedStrength } from './predicted';

vi.mock('@/lib/learn/levels/loader-grade', () => ({ loadGradeMap: vi.fn() }));

function clientReturning(result: { data: unknown; error: { message: string } | null }) {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => result,
  };
  return { from: () => query } as unknown as LearnSupabaseClient;
}

const AT = new Date('2026-10-15T12:00:00Z');

describe('predictedStrength', () => {
  it('is the strength score on the day the question is asked', async () => {
    const client = clientReturning({
      data: {
        state: 'known',
        established: 'tested',
        tested_at: '2026-09-15T12:00:00Z',
        declared_at: null,
        review_interval_days: null,
      },
      error: null,
    });
    // 0.8 times 1 times 2^(-30/30) is 0.4.
    expect(await predictedStrength(client, 'c', AT)).toBe(0.4);
  });

  it('is 0 for an idea nothing has been judged about', async () => {
    expect(await predictedStrength(clientReturning({ data: null, error: null }), 'c', AT)).toBe(0);
  });

  it('is null, not a throw, when the state cannot be read', async () => {
    const client = clientReturning({ data: null, error: { message: 'down' } });
    expect(await predictedStrength(client, 'c', AT)).toBeNull();
  });
});

describe('predictedCell', () => {
  const learn = {} as LearnSupabaseClient;
  const map = {
    topics: [{ id: 't', name: 'T', ceiling: 10, approved: true }],
    cells: [
      { id: 'c1', topicId: 't', level: 1, descriptor: [] },
      { id: 'c2', topicId: 't', level: 2, descriptor: [] },
    ],
    links: [],
    evidence: [{ id: 'e', cellId: 'c2', verdict: 'met', observedAt: '2026-10-01T00:00:00Z' }],
  };

  it('is the status the cell reads as (a lower level below a shown one is implied) and its level', async () => {
    vi.mocked(loadGradeMap).mockResolvedValue(map as never);
    expect(await predictedCell(learn, 'u', 'c1')).toEqual({ status: 'implied', level: 1 });
    expect(await predictedCell(learn, 'u', 'c2')).toEqual({ status: 'shown', level: 2 });
  });

  it('is null when the map cannot be read', async () => {
    vi.mocked(loadGradeMap).mockRejectedValueOnce(new Error('down'));
    expect(await predictedCell(learn, 'u', 'c1')).toBeNull();
  });
});
