import { describe, expect, it } from 'vitest';
import { admitOpenings, scoredColumns } from './admit';
import type { OpeningScores } from './scores';

const fit = (value: number): OpeningScores => ({ fit_score: { value, confidence: 0.9 } });
const toOpening = (title: string) => ({ title, company: 'Acme', location: null, why: '', move: '' });

describe('admitOpenings', () => {
  it('scores each role and marks the ones under the minimum', async () => {
    const scores: Record<string, OpeningScores | null> = { Finance: fit(60), Engineer: fit(8), Unscorable: null };
    const admitted = await admitOpenings(['Finance', 'Engineer', 'Unscorable'], toOpening, {
      score: async (opening) => scores[opening.title],
      minFitScore: 25,
    });
    expect(admitted.map((a) => [a.item, a.belowGate])).toEqual([
      ['Finance', false],
      ['Engineer', true],
      ['Unscorable', false],
    ]);
  });

  it('lets roles on unscored once the time is spent, and survives a scorer that throws', async () => {
    const admitted = await admitOpenings(
      ['A', 'B'],
      toOpening,
      { score: async () => { throw new Error('down'); }, minFitScore: 25 },
      0,
    );
    expect(admitted.every((a) => a.scores === null && !a.belowGate)).toBe(true);
  });
});

describe('scoredColumns', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  it('writes a role under the minimum as expired for low fit', () => {
    expect(scoredColumns({ item: 'x', scores: fit(8), belowGate: true }, 'jev-1', now)).toMatchObject({
      status: 'expired',
      expired_reason: 'low_fit',
      score_model: 'jev-1',
    });
    expect(scoredColumns({ item: 'x', scores: fit(60), belowGate: false }, 'jev-1', now)).not.toHaveProperty('status');
    expect(scoredColumns({ item: 'x', scores: null, belowGate: false }, 'jev-1', now)).toEqual({});
  });
});
