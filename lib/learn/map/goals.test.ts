import { describe, expect, it } from 'vitest';
import type { LensRecord } from '@/lib/learn/levels/lenses';
import { readCells, type CellEvidence, type LevelCell, type LevelTopic, type TopicMap } from '@/lib/learn/levels/model';
import { goalsOnMap, ringRadius, territoriesOnMap, type TopicPlacement } from './goals';

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

describe('territoriesOnMap', () => {
  const AROUND = new Map([['capm', { ideaIds: ['i1', 'i2'], slot: 3 as const }]]);

  it('gives each placed topic its ladder and target, and links at topic and level', () => {
    const m = map([
      { cellId: 'return2', verdict: 'met', observedAt: '2026-10-10T09:00:00Z' },
      { cellId: 'capm1', verdict: 'not_met', observedAt: '2026-10-11T09:00:00Z' },
    ]);
    const [territory] = territoriesOnMap(
      [lens('g', 'goal', [['capm', 4], ['return', 3], ['dcf', 5]]), lens('s', 'subject', [['beta', 3]])],
      m,
      readCells(m),
      PLACED,
      AROUND,
    );
    expect(territory!.id).toBe('g');
    const byId = new Map(territory!.topics.map((t) => [t.id, t]));
    expect([...byId.keys()].sort()).toEqual(['capm', 'dcf', 'return']);
    expect(byId.get('return')).toMatchObject({ tested: 2, held: 2, target: 3, ceiling: 6, slot: 'none', ideaIds: [] });
    expect(byId.get('capm')).toMatchObject({ missed: [1], target: 4, slot: 3, ideaIds: ['i1', 'i2'] });
    // Beta is on no goal, so its link is left off.
    expect(territory!.links).toEqual([
      { requiringTopicId: 'capm', requiringLevel: 3, requiredTopicId: 'return', requiredLevel: 2 },
      { requiringTopicId: 'capm', requiringLevel: 5, requiredTopicId: 'return', requiredLevel: 4 },
    ]);
  });

  it('lists what is ready inside the targets in engine order, the miss first and never a draft', () => {
    const m = map([{ cellId: 'capm1', verdict: 'not_met', observedAt: '2026-10-11T09:00:00Z' }]);
    const readings = readCells(m);
    const [territory] = territoriesOnMap([lens('g', 'goal', [['capm', 4], ['return', 3], ['dcf', 5]])], m, readings, PLACED, AROUND);
    const ready = territory!.ready!;
    expect(ready[0]).toMatchObject({ topicId: 'capm', level: 1, cellId: 'capm1' });
    expect(ready.some((r) => r.topicId === 'dcf')).toBe(false);
    expect(ready.every((r) => r.topicId === 'capm' || r.topicId === 'return')).toBe(true);
  });

  it('leaves a topic with no place out, and its links with it', () => {
    const m = map();
    const [territory] = territoriesOnMap(
      [lens('g', 'goal', [['capm', 4], ['return', 3]])],
      m,
      readCells(m),
      new Map([['capm', at(0.1)]]),
      AROUND,
    );
    expect(territory!.topics.map((t) => t.id)).toEqual(['capm']);
    expect(territory!.links).toEqual([]);
    expect(territory!.ready!.every((r) => r.topicId === 'capm')).toBe(true);
  });
});

describe('ringRadius', () => {
  it('widens with the target and stays within the ladder', () => {
    expect(ringRadius(2)).toBeLessThan(ringRadius(5));
    expect(ringRadius(12)).toBe(ringRadius(10));
    expect(ringRadius(0)).toBe(ringRadius(1));
  });
});
