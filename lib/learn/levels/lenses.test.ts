import { describe, expect, it } from 'vitest';
import {
  bandCounts,
  fieldLevels,
  goalTargetLevel,
  heldLine,
  lensHeld,
  lensDetail,
  lensLine,
  meanText,
  summariseLens,
  type LensRecord,
  type TopicName,
} from './lenses';
import { readCells, type CellEvidence, type LevelCell, type LevelTopic, type TopicMap } from './model';

/** CAPM 3 needs Return 2; a draft, DCF, sits on the lens unapproved. */
const TOPICS: LevelTopic[] = [
  { id: 'capm', name: 'CAPM', ceiling: 10, approved: true },
  { id: 'return', name: 'Return', ceiling: 6, approved: true },
  { id: 'dcf', name: 'DCF', ceiling: 8, approved: false },
];

function cellsFor(topics: readonly LevelTopic[]): LevelCell[] {
  return topics.flatMap((t) =>
    Array.from({ length: t.ceiling }, (_, i) => ({ id: `${t.id}${i + 1}`, topicId: t.id, level: i + 1 })),
  );
}

function map(evidence: CellEvidence[] = []): TopicMap {
  return {
    topics: TOPICS,
    cells: cellsFor(TOPICS),
    links: [{ requiringCellId: 'capm3', requiredCellId: 'return2' }],
    evidence,
  };
}

const NAMES = new Map<string, TopicName>(TOPICS.map((t) => [t.id, { id: t.id, name: t.name, approved: t.approved, ceiling: t.ceiling }]));

const LENS: LensRecord = {
  id: 'lens',
  name: 'Corporate finance',
  origin: 'subject',
  subjectId: 'subject',
  aimId: null,
  createdAt: '2026-10-01T09:00:00Z',
  targets: [
    { topicId: 'capm', targetLevel: 4, addedAt: '2026-10-01T09:00:00Z' },
    { topicId: 'return', targetLevel: 3, addedAt: '2026-10-15T08:00:00Z' },
    { topicId: 'dcf', targetLevel: 5, addedAt: '2026-10-15T08:00:00Z' },
  ],
};

const DAY = { today: '2026-10-15', dayOf: (at: string) => at.slice(0, 10) };

describe('goalTargetLevel', () => {
  it('maps each depth to its level and never passes the ceiling', () => {
    expect(goalTargetLevel('familiar', 10)).toBe(2);
    expect(goalTargetLevel('solid', 10)).toBe(5);
    expect(goalTargetLevel('deep', 10)).toBe(8);
    expect(goalTargetLevel('deep', 6)).toBe(6);
    expect(goalTargetLevel('unknown', 10)).toBe(2);
  });
});

describe('bandCounts', () => {
  it('counts topics per band in ladder order, keeping empty bands', () => {
    expect(bandCounts([0, 1, 2, 3, 6, 10])).toEqual([
      { band: 'Unplaced', topics: 1 },
      { band: 'Aware', topics: 2 },
      { band: 'Working', topics: 1 },
      { band: 'Fluent', topics: 1 },
      { band: 'Expert', topics: 1 },
    ]);
  });
});

describe('summariseLens', () => {
  it('counts approved topics only and reports the drafts apart', () => {
    const m = map([{ cellId: 'return2', verdict: 'met', observedAt: '2026-10-02T10:00:00Z' }]);
    const summary = summariseLens(LENS, m, readCells(m), NAMES);
    // CAPM 1-4 and Return 1-3 count; Return 1 and 2 are held.
    expect(summary).toMatchObject({ topics: 2, drafts: 1, held: 2, total: 7 });
    expect(lensLine(summary)).toBe('2 topics · 2 of 7 levels held');
  });

  it('says a lens with only a draft has a draft to approve', () => {
    const lens: LensRecord = { ...LENS, targets: [LENS.targets[2]] };
    const m = map();
    expect(lensLine(summariseLens(lens, m, readCells(m), NAMES))).toBe('A draft topic to approve');
    expect(lensLine(summariseLens({ ...LENS, targets: [] }, m, readCells(m), NAMES))).toBe('No topics yet');
  });
});

describe('heldLine', () => {
  it('keeps tested and inferred apart, over the levels to reach', () => {
    // Return 2 met directly shows Return 1 as implied; nothing else is touched.
    const m = map([{ cellId: 'return2', verdict: 'met', observedAt: '2026-10-02T10:00:00Z' }]);
    const held = lensHeld(LENS, m, readCells(m), NAMES);
    expect(held).toEqual({ tested: 1, inferred: 1, declared: 0, total: 7 });
    expect(heldLine(held)).toBe('1 of 7 levels tested · 1 inferred');
  });

  it('says nothing for a lens with no levels to reach', () => {
    expect(heldLine({ tested: 0, inferred: 0, declared: 0, total: 0 })).toBeNull();
  });
});

describe('lensDetail', () => {
  const m = map([{ cellId: 'return2', verdict: 'met', observedAt: '2026-10-02T10:00:00Z' }]);
  const detail = lensDetail(LENS, m, readCells(m), NAMES, DAY);

  it('lists approved topics first, each with its level and target', () => {
    expect(detail.topics.map((t) => [t.name, t.approved, t.level, t.target])).toEqual([
      ['CAPM', true, 0, 4],
      ['Return', true, 2, 3],
      ['DCF', false, 0, 5],
    ]);
  });

  it('puts the fringe inside the lens on each topic, with why', () => {
    const capm = detail.topics.find((t) => t.topicId === 'capm')!;
    const ret = detail.topics.find((t) => t.topicId === 'return')!;
    expect(capm.fringe.map((c) => c.level)).toEqual([1]);
    expect(capm.fringe[0].why).toMatch(/CAPM can start here/);
    expect(ret.fringe.map((c) => c.level)).toEqual([3]);
    expect(ret.fringe[0].why).toMatch(/^The next level up on Return/);
  });

  it('names the topics added today and counts bands over approved topics', () => {
    expect(detail.addedToday).toEqual(['Return', 'DCF']);
    expect(detail.bands.find((b) => b.band === 'Aware')?.topics).toBe(1);
    expect(detail.bands.find((b) => b.band === 'Unplaced')?.topics).toBe(1);
  });
});

describe('fieldLevels', () => {
  it('gives each tagged field the mean level of its approved topics', () => {
    const m = map([{ cellId: 'return2', verdict: 'met', observedAt: '2026-10-02T10:00:00Z' }]);
    const tags = new Map([
      ['capm', ['finance']],
      ['return', ['finance', 'stats']],
      ['dcf', ['valuation']],
    ]);
    const fields = [
      { id: 'finance', name: 'Finance' },
      { id: 'stats', name: 'Statistics' },
      { id: 'valuation', name: 'Valuation' },
    ];
    expect(fieldLevels(m, readCells(m), tags, fields)).toEqual([
      { fieldId: 'stats', name: 'Statistics', topics: 1, mean: 2 },
      { fieldId: 'finance', name: 'Finance', topics: 2, mean: 1 },
    ]);
  });

  it('writes a mean with one decimal unless it is whole', () => {
    expect(meanText(3)).toBe('3');
    expect(meanText(3.456)).toBe('3.5');
  });
});
