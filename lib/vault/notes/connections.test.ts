import { describe, expect, it } from 'vitest';
import {
  CONNECTIONS_SHOWN,
  droppedBecause,
  nearlySameTitle,
  pickConnections,
  sharesTitleWord,
  type NeighbourPair,
} from '@/lib/vault/notes/connections';

/**
 * Which pairs become the week's connections. The pairs below are the live
 * vault's, from the week of 19 September 2026 (plan #1115), so each rule is
 * checked on the case that made it.
 */

function pair(
  recent: string,
  older: string,
  similarity: number,
  extra: Partial<NeighbourPair> = {},
): NeighbourPair {
  return {
    recentId: extra.recentId ?? `r-${recent}`,
    recentPath: extra.recentPath ?? `Yale/${recent}.md`,
    recentTitle: recent,
    recentChars: 5_000,
    olderId: extra.olderId ?? `o-${older}`,
    olderPath: extra.olderPath ?? `Pending/${older}.md`,
    olderTitle: older,
    olderChars: 5_000,
    similarity,
    mutualRank: 1,
    ...extra,
  };
}

describe('the pairs left out', () => {
  it('keeps a pair across subjects the person did not name alike', () => {
    expect(droppedBecause(pair('MGT 649 - World Financial History', 'Money Changes Everything', 0.768))).toBeNull();
    expect(droppedBecause(pair('bang on the drum all day', 'About me', 0.63))).toBeNull();
  });

  it('drops a weak pair and the same material twice', () => {
    expect(droppedBecause(pair('A note', 'Another', 0.54))).toBe('weak');
    expect(droppedBecause(pair('Summary of week', 'Lecture', 0.93))).toBe('same material');
  });

  it('drops an older note that is near everything', () => {
    expect(
      droppedBecause(pair('MGT 541 - Corporate Finance', 'Financial Markets Problem Set 1', 0.809, { mutualRank: 13 })),
    ).toBe('hub');
  });

  it('drops two notes named alike', () => {
    expect(droppedBecause(pair('MGT 850 - Science of Experience', 'MGT 850 - The Science of Experience', 0.8))).toBe(
      'named alike',
    );
    expect(droppedBecause(pair('covet health application', 'UPSTACK Application', 0.757))).toBe('named alike');
  });

  it('drops two applications however they are named', () => {
    expect(
      droppedBecause(
        pair('Galaxy Take Home Quiz', 'Adonis Application', 0.679, {
          recentPath: 'Career/Job Applications/Galaxy Take Home Quiz.md',
          olderPath: 'Career/Job Applications/Adonis Application.md',
        }),
      ),
    ).toBe('applications');
  });

  it('drops an index or an export on either side', () => {
    expect(droppedBecause(pair('_Master Summary', 'MGT 430 - The Executive', 0.777))).toBe('export');
    expect(droppedBecause(pair('Yale Combined', 'Hedge Funds', 0.672, { recentChars: 383_887 }))).toBe('export');
  });
});

describe('title words', () => {
  it('ignores short and common words and plurals', () => {
    expect(sharesTitleWord('on following your passion', 'bang on the drum all day')).toBe(false);
    expect(sharesTitleWord('Job Applications', 'array application')).toBe(true);
  });

  it('calls two titles nearly the same when half their words are shared', () => {
    expect(nearlySameTitle('MGT 885 - Commercial Real Estate Investing', 'MGT 885 - Commercial Real Estate Investing')).toBe(true);
    expect(nearlySameTitle('MGT 816 - Private Firm CFO', 'MGT 847 - Private Equity Leveraged Buyouts')).toBe(false);
  });
});

describe('picking the week', () => {
  it('groups recent notes by the older note they come back to, each in its closest group only', () => {
    const picked = pickConnections([
      pair('MGT 816 - Private Firm CFO', 'Galaxy Digital Application', 0.837, { mutualRank: 3 }),
      pair('MGT 847 - Private Equity Leveraged Buyouts', 'Galaxy Digital Application', 0.804, { mutualRank: 4 }),
      pair('MGT 847 - Private Equity Leveraged Buyouts', 'Venture Capital', 0.7),
      pair('MGT 411 - Customer', 'Business Frameworks', 0.778),
    ]);
    expect(picked.map((c) => [c.older.title, c.recent.map((n) => n.title)])).toEqual([
      ['Galaxy Digital Application', ['MGT 816 - Private Firm CFO', 'MGT 847 - Private Equity Leveraged Buyouts']],
      ['Business Frameworks', ['MGT 411 - Customer']],
    ]);
    expect(picked[0]!.similarity).toBe(0.837);
  });

  it('names a course and its summary once', () => {
    const [only] = pickConnections([
      pair('MGT 885 - Commercial Real Estate Investing', 'CRE - Homework 2', 0.765, {
        recentId: 'summary',
        recentPath: 'Yale/Course Summaries/MGT 885 - Commercial Real Estate Investing.md',
      }),
      pair('MGT 885 - Commercial Real Estate Investing', 'CRE - Homework 2', 0.752, { recentId: 'notes' }),
    ]);
    expect(only!.recent.map((note) => note.id)).toEqual(['summary']);
  });

  it('keeps at most three, fuller groups first', () => {
    const picked = pickConnections([
      pair('One', 'Alpha', 0.8),
      pair('Two', 'Beta', 0.79),
      pair('Three', 'Gamma', 0.78),
      pair('Four', 'Delta', 0.6),
      pair('Five', 'Delta', 0.6),
    ]);
    expect(picked).toHaveLength(CONNECTIONS_SHOWN);
    expect(picked.map((c) => c.older.title)).toEqual(['Delta', 'Alpha', 'Beta']);
  });

  it('gives nothing for a week with nothing worth saying', () => {
    expect(pickConnections([pair('array application', 'Ask My AI - Knowledge Base', 0.687, { mutualRank: 52 })])).toEqual(
      [],
    );
    expect(pickConnections([])).toEqual([]);
  });
});
