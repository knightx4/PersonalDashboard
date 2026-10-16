import { describe, expect, it } from 'vitest';
import type { LensRecord } from '@/lib/learn/levels/lenses';
import { readCells, type CellEvidence, type LevelCell, type LevelTopic, type TopicMap } from '@/lib/learn/levels/model';
import { goalsOnMap, ringRadius, type TopicPlacement } from './goals';

/** CAPM 3 needs Return 2; DCF is a draft; Beta is on no goal. */
const TOPICS: LevelTopic[] = [
  { id: 'capm', name: 'CAPM', ceiling: 10, approved: true },
  { id: 'return', name: 'Return', ceiling: 6, approved: true },
  { id: 'dcf', name: 'DCF', ceiling: 8, approved: false },
  { id: 'beta', name: 'Beta', ceiling: 6, approved: true },
];

const CELLS: LevelCell[] = TOPICS.flatMap((t) =>
  Array.from({ length: t.ceiling }, (_, i) => ({ id: `${t.id}${i + 1}`, topicId: t.id, level: i + 1 })),
);

function map(evidence: CellEvidence[] = []): TopicMap {
  return {
    topics: TOPICS,
    cells: CELLS,
    links: [
      { requiringCellId: 'capm3', requiredCellId: 'return2' },
      { requiringCellId: 'capm5', requiredCellId: 'return4' },
      { requiringCellId: 'capm4', requiredCellId: 'beta2' },
    ],
    evidence,
  };
}

const lens = (id: string, origin: LensRecord['origin'], topics: [string, number][]): LensRecord => ({
  id,
  name: `Lens ${id}`,
  origin,
  subjectId: origin === 'subject' ? 's' : null,
  aimId: origin === 'goal' ? 'a' : null,
  createdAt: '2026-10-01T09:00:00Z',
  targets: topics.map(([topicId, targetLevel]) => ({ topicId, targetLevel, addedAt: '2026-10-01T09:00:00Z' })),
});

const at = (x: number): TopicPlacement => ({ pca: { x, y: 0 }, neighbourMap: { x, y: x } });
const PLACED = new Map<string, TopicPlacement>([
  ['capm', at(0.1)],
  ['return', at(0.2)],
  ['dcf', at(0.3)],
  ['beta', at(0.4)],
]);

describe('goalsOnMap', () => {
  it('keeps goals only, with each topic placed and ringed at its target', () => {
    const m = map();
    const goals = goalsOnMap(
      [lens('g', 'goal', [['capm', 4], ['return', 3], ['dcf', 5]]), lens('s', 'subject', [['beta', 3]])],
      m,
      readCells(m),
      PLACED,
    );
    expect(goals.map((g) => g.id)).toEqual(['g']);
    const [goal] = goals;
    expect(goal!.stars.map((s) => [s.topicId, s.targetLevel])).toEqual([
      ['capm', 4],
      ['return', 3],
      ['dcf', 5],
    ]);
    expect(goal!.stars[0]!.neighbourMap).toEqual({ x: 0.1, y: 0.1 });
  });

  it('draws one line per pair of its own topics, never to a topic outside it', () => {
    const m = map();
    const [goal] = goalsOnMap([lens('g', 'goal', [['capm', 4], ['return', 3]])], m, readCells(m), PLACED);
    expect(goal!.links).toEqual([{ from: 'capm', to: 'return' }]);
  });

  it('leaves a topic with no place off the sky', () => {
    const m = map();
    const [goal] = goalsOnMap(
      [lens('g', 'goal', [['capm', 4], ['return', 3]])],
      m,
      readCells(m),
      new Map([['capm', at(0.1)]]),
    );
    expect(goal!.stars.map((s) => s.topicId)).toEqual(['capm']);
    expect(goal!.links).toEqual([]);
  });

  it('names the next rung as the lowest level it is ready for', () => {
    const m = map([{ cellId: 'return1', verdict: 'met', observedAt: '2026-10-10T09:00:00Z' }]);
    const [goal] = goalsOnMap([lens('g', 'goal', [['capm', 4], ['return', 3]])], m, readCells(m), PLACED);
    expect(goal!.next).toBe('Next: CAPM at level 1, place it');
    expect(goal!.line).toBe('2 topics · 1 of 7 levels held');
  });

  it('says every target is held once they are, and nothing for drafts alone', () => {
    const m = map([{ cellId: 'return3', verdict: 'met', observedAt: '2026-10-10T09:00:00Z' }]);
    const [held] = goalsOnMap([lens('g', 'goal', [['return', 3]])], m, readCells(m), PLACED);
    expect(held!.next).toBe('Every target held');
    const [drafts] = goalsOnMap([lens('d', 'goal', [['dcf', 5]])], m, readCells(m), PLACED);
    expect(drafts!.next).toBeNull();
    expect(drafts!.line).toBe('A draft topic to approve');
  });
});

describe('ringRadius', () => {
  it('widens with the target and stays within the ladder', () => {
    expect(ringRadius(2)).toBeLessThan(ringRadius(5));
    expect(ringRadius(12)).toBe(ringRadius(10));
    expect(ringRadius(0)).toBe(ringRadius(1));
  });
});
