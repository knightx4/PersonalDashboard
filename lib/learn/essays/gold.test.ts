import { describe, expect, it } from 'vitest';
import gold from './fixtures/gold-sox-ai.json';
import runs from './fixtures/runs-2026-10-15.json';
import { scoreAgainstGold, type GoldSource } from './gold';

const GOLD = gold.sources as GoldSource[];

describe('the gold list for the test essay', () => {
  it('has seven required sources, two optional and one stale', () => {
    expect(GOLD.filter((g) => !g.optional && !g.stale)).toHaveLength(7);
    expect(GOLD.filter((g) => g.optional)).toHaveLength(2);
    expect(GOLD.filter((g) => g.stale).map((g) => g.id)).toEqual(['sr-11-7']);
  });

  it('recognises a primary document by address and a write-up as not one', () => {
    const score = scoreAgainstGold(
      [
        { url: 'https://www.coso.org/generative-ai', title: 'Generative AI' },
        {
          url: 'https://www.journalofaccountancy.com/news/2026/feb/coso-creates-audit-ready-guidance-for-governing-generative-ai/',
          title: 'COSO creates guidance',
        },
        { url: 'https://www.fdic.gov/sites/default/files/2024-03/fil17022a.pdf', title: 'SR 11-7' },
      ],
      GOLD,
    );
    expect(score.hits).toEqual(['coso-genai-2026']);
    expect(score.stale).toEqual(['https://www.fdic.gov/sites/default/files/2024-03/fil17022a.pdf']);
  });
});

describe('the baseline: the two real runs before evidence on points', () => {
  it.each(runs.runs)('$at ($design) finds none of the required sources', (run) => {
    const score = scoreAgainstGold(run.sources, GOLD);
    expect(score.recall).toBe(0);
    expect(score.precision).toBe(0);
  });
});
