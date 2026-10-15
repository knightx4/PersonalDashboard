import { describe, expect, it } from 'vitest';
import { proposeArticles, type ProposePorts } from './propose';
import { MAX_TITLES } from './pull';

function ports(map: Record<string, string | null>, held: string[] = []): ProposePorts {
  return {
    search: async (name) => (name in map ? { ok: true, title: map[name] } : { ok: false, detail: 'down' }),
    held: async () => new Set(held),
  };
}

describe('proposeArticles', () => {
  it('proposes the top hit for each idea, once', async () => {
    const report = await proposeArticles(
      ports({
        'Marginal cost': 'Marginal cost',
        'Cost at the margin': 'Marginal cost',
        Elasticity: 'Elasticity (economics)',
        Zzz: null,
      }),
      ['Marginal cost', 'Cost at the margin', 'Elasticity', 'Zzz'],
    );
    expect(report.proposals).toEqual([
      { title: 'Marginal cost', idea: 'Marginal cost' },
      { title: 'Elasticity (economics)', idea: 'Elasticity' },
    ]);
    expect(report).toMatchObject({ unmatched: 1, duplicates: 1, inCatalogue: 0, overLimit: 0, stopped: null });
  });

  it('leaves out articles the catalogue already holds, spaces or underscores', async () => {
    const report = await proposeArticles(
      ports({ A: 'Marginal utility', B: 'Inflation' }, ['Marginal_utility']),
      ['A', 'B'],
    );
    expect(report.proposals.map((p) => p.title)).toEqual(['Inflation']);
    expect(report.inCatalogue).toBe(1);
  });

  it('keeps what it found when Wikipedia stops answering', async () => {
    const report = await proposeArticles(ports({ A: 'Alpha' }), ['A', 'B']);
    expect(report.proposals).toHaveLength(1);
    expect(report.stopped).toBe('down');
  });

  it('stays within one press', async () => {
    const names = Array.from({ length: MAX_TITLES + 3 }, (_, i) => `n${i}`);
    const report = await proposeArticles(
      ports(Object.fromEntries(names.map((n) => [n, `T ${n}`]))),
      names,
    );
    expect(report.proposals).toHaveLength(MAX_TITLES);
    expect(report.overLimit).toBe(3);
  });
});
