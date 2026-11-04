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
 * Which pairs become the week's connections. The pairs below are made up in
 * the shape of the cases that made each rule (plan #1115).
 */

function pair(
  recent: string,
  older: string,
  similarity: number,
  extra: Partial<NeighbourPair> = {},
): NeighbourPair {
  return {
    recentId: extra.recentId ?? `r-${recent}`,
    recentPath: extra.recentPath ?? `Courses/${recent}.md`,
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
    expect(droppedBecause(pair('ECON 210 - History of Trade', 'Notes on Shipping', 0.768))).toBeNull();
    expect(droppedBecause(pair('a song stuck in my head', 'What I want next', 0.63))).toBeNull();
  });

  it('drops a weak pair and the same material twice', () => {
    expect(droppedBecause(pair('A note', 'Another', 0.54))).toBe('weak');
    expect(droppedBecause(pair('Summary of week', 'Lecture', 0.93))).toBe('same material');
  });

  it('drops an older note that is near everything', () => {
    expect(
      droppedBecause(pair('STAT 101 - Sampling', 'Probability Problem Set 1', 0.809, { mutualRank: 13 })),
    ).toBe('hub');
  });

  it('drops two notes named alike', () => {
    expect(droppedBecause(pair('STAT 101 - Week 1', 'STAT 101 - The Week 1', 0.8))).toBe(
      'named alike',
    );
    expect(droppedBecause(pair('acme application', 'Northwind Application', 0.757))).toBe('named alike');
  });

  it('drops two applications however they are named', () => {
    expect(
      droppedBecause(
        pair('Halvorsen Take Home Quiz', 'Northwind Application', 0.679, {
          recentPath: 'Career/Job Applications/Halvorsen Take Home Quiz.md',
          olderPath: 'Career/Job Applications/Northwind Application.md',
        }),
      ),
    ).toBe('applications');
  });

  it('drops an index or an export on either side', () => {
    expect(droppedBecause(pair('_Master Summary', 'STAT 210 - Regression', 0.777))).toBe('export');
    expect(droppedBecause(pair('Courses Combined', 'Index Funds', 0.672, { recentChars: 383_887 }))).toBe('export');
  });
});

describe('title words', () => {
  it('ignores short and common words and plurals', () => {
    expect(sharesTitleWord('on choosing a hobby', 'a song stuck in my head')).toBe(false);
    expect(sharesTitleWord('Job Applications', 'array application')).toBe(true);
  });

  it('calls two titles nearly the same when half their words are shared', () => {
    expect(nearlySameTitle('STAT 310 - Survey Design and Analysis', 'STAT 310 - Survey Design and Analysis')).toBe(true);
    expect(nearlySameTitle('STAT 216 - Time Series Forecasting', 'STAT 247 - Time Series Methods')).toBe(false);
  });
});

describe('picking the week', () => {
  it('groups recent notes by the older note they come back to, each in its closest group only', () => {
    const picked = pickConnections([
      pair('STAT 216 - Time Series Forecasting', 'Halvorsen Digital Application', 0.837, { mutualRank: 3 }),
      pair('STAT 247 - Time Series Methods', 'Halvorsen Digital Application', 0.804, { mutualRank: 4 }),
      pair('STAT 247 - Time Series Methods', 'Venture Capital', 0.7),
      pair('STAT 150 - Data Visualisation', 'Business Frameworks', 0.778),
    ]);
    expect(picked.map((c) => [c.older.title, c.recent.map((n) => n.title)])).toEqual([
      ['Halvorsen Digital Application', ['STAT 216 - Time Series Forecasting', 'STAT 247 - Time Series Methods']],
      ['Business Frameworks', ['STAT 150 - Data Visualisation']],
    ]);
    expect(picked[0]!.similarity).toBe(0.837);
  });

  it('names a course and its summary once', () => {
    const [only] = pickConnections([
      pair('STAT 310 - Survey Design and Analysis', 'Problem Set 2', 0.765, {
        recentId: 'summary',
        recentPath: 'Courses/Course Summaries/STAT 310 - Survey Design and Analysis.md',
      }),
      pair('STAT 310 - Survey Design and Analysis', 'Problem Set 2', 0.752, { recentId: 'notes' }),
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
