import { describe, expect, it } from 'vitest';
import { readCells, type CellEvidence, type LevelCell, type LevelTopic, type TopicMap, type Verdict } from './model';
import {
  firstNotHeld,
  heldPieces,
  pickPlacement,
  placedTopics,
  placementOrder,
  PLACEMENT_QUESTIONS,
  type PlacementPiece,
} from './placement';

const NOW = new Date('2026-10-17T12:00:00Z');
const START = '2026-10-17T11:00:00.000Z';

function cellsFor(topics: readonly LevelTopic[]): LevelCell[] {
  return topics.flatMap((t) =>
    Array.from({ length: t.ceiling }, (_, i) => ({ id: `${t.id}${i + 1}`, topicId: t.id, level: i + 1 })),
  );
}

const RENT: LevelTopic = { id: 'rent', name: 'Bid-rent curves', ceiling: 8, approved: true };
const AGG: LevelTopic = { id: 'agg', name: 'Agglomeration', ceiling: 8, approved: true };
const ZONE: LevelTopic = { id: 'zone', name: 'Zoning', ceiling: 6, approved: true };
const DRAFT: LevelTopic = { id: 'draft', name: 'Draft topic', ceiling: 6, approved: false };

function map(topics: LevelTopic[], evidence: CellEvidence[] = []): TopicMap {
  return { topics, cells: cellsFor(topics), links: [], evidence };
}

function piece(
  id: string,
  unitOrdinal: number,
  ordinal: number,
  cellIds: string[],
  passed = false,
  held = false,
): PlacementPiece {
  return { id, unitOrdinal, ordinal, title: id, cellIds, passed, held };
}

const cellTopic = new Map(cellsFor([RENT, AGG, ZONE]).map((c) => [c.id, c.topicId]));

describe('placementOrder', () => {
  it('takes topics as the pieces first teach them, then the rest of the lens', () => {
    const pieces = [piece('b', 1, 2, ['zone1']), piece('a', 1, 1, ['agg2', 'zone1']), piece('c', 2, 1, ['rent1'])];
    expect(placementOrder(['rent', 'agg', 'zone', 'other'], pieces, cellTopic)).toEqual(['agg', 'zone', 'rent', 'other']);
  });

  it('leaves out a topic the lens does not hold', () => {
    expect(placementOrder(['zone'], [piece('a', 1, 1, ['agg1'])], cellTopic)).toEqual(['zone']);
  });
});

describe('pickPlacement', () => {
  it('bisects the first topic to the end before starting the next', () => {
    const order = ['rent', 'agg'];
    const evidence: CellEvidence[] = [];
    const topics: string[] = [];
    for (let asked = 0; ; asked += 1) {
      const p = pickPlacement(map([RENT, AGG], evidence), { order, now: NOW, asked });
      if (!p) break;
      expect(p.reason).toBe('placement');
      topics.push(p.topicId);
      // Rent held to 3, agglomeration to 6. Answered long enough ago not to rest.
      const truth = p.topicId === 'rent' ? 3 : 6;
      evidence.push({ cellId: p.cellId, verdict: (p.level <= truth ? 'met' : 'not_met') as Verdict, observedAt: `2026-10-01T10:00:0${asked}Z` });
    }
    const firstAgg = topics.indexOf('agg');
    expect(firstAgg).toBeGreaterThan(0);
    expect(topics.slice(firstAgg).every((t) => t === 'agg')).toBe(true);
    expect(topics.length).toBeLessThanOrEqual(PLACEMENT_QUESTIONS);
  });

  describe('with confidence on the last answer (plan #2522.5)', () => {
    const second = (verdict: Verdict, confidence: number | null | undefined, level = 4) => {
      const ev: CellEvidence = { cellId: `rent${level}`, verdict, observedAt: '2026-10-01T10:00:00Z', confidence };
      return pickPlacement(map([RENT], [ev]), { order: ['rent'], now: NOW, asked: 1 });
    };

    it('asks the first question at the middle', () => {
      expect(pickPlacement(map([RENT]), { order: ['rent'], now: NOW, asked: 0 })).toMatchObject({ level: 4 });
    });

    it('jumps two levels on a right answer at Certain and at Fairly sure', () => {
      expect(second('met', 0.95)).toMatchObject({ level: 6 });
      expect(second('met', 0.75)).toMatchObject({ level: 6 });
    });

    it('moves one level on a right answer at Unsure and at Guessing', () => {
      expect(second('met', 0.5)).toMatchObject({ level: 5 });
      expect(second('met', 0.25)).toMatchObject({ level: 5 });
    });

    it('bisects without a confidence, and steps one level at Unsure from level 2', () => {
      expect(second('met', null)).toMatchObject({ level: 6 });
      expect(second('met', undefined)).toMatchObject({ level: 6 });
      expect(second('met', 0.5, 2)).toMatchObject({ level: 3 });
    });

    it('does not jump past the lowest miss', () => {
      const m = map([RENT], [
        { cellId: 'rent4', verdict: 'met', observedAt: '2026-10-01T10:00:00Z', confidence: 0.95 },
        { cellId: 'rent6', verdict: 'not_met', observedAt: '2026-10-01T09:00:00Z' },
      ]);
      expect(pickPlacement(m, { order: ['rent'], now: NOW, asked: 2 })).toMatchObject({ level: 5 });
    });

    it('narrows down on a miss whatever the confidence', () => {
      expect(second('not_met', 0.95)).toMatchObject({ level: 2 });
    });
  });

  it('stops at eight questions', () => {
    expect(pickPlacement(map([RENT]), { order: ['rent'], now: NOW, asked: PLACEMENT_QUESTIONS })).toBeNull();
    expect(pickPlacement(map([RENT]), { order: ['rent'], now: NOW, asked: PLACEMENT_QUESTIONS - 1 })).not.toBeNull();
  });

  it('passes over a draft and a topic already placed', () => {
    const placed = map([DRAFT, ZONE, AGG], [
      { cellId: 'zone6', verdict: 'met', observedAt: '2026-10-01T10:00:00Z' },
    ]);
    expect(pickPlacement(placed, { order: ['draft', 'zone', 'agg'], now: NOW, asked: 0 })).toMatchObject({ topicId: 'agg' });
  });

  it('returns null when nothing in the order is left to place', () => {
    expect(pickPlacement(map([RENT]), { order: ['agg'], now: NOW, asked: 0 })).toBeNull();
  });
});

describe('heldPieces and firstNotHeld', () => {
  const m = map([RENT, AGG], [
    { cellId: 'rent3', verdict: 'met', observedAt: START },
    { cellId: 'agg2', verdict: 'not_met', observedAt: START },
  ]);
  const readings = readCells(m);

  it('holds a piece whose cells are all held, and no other', () => {
    const pieces = [
      piece('held', 1, 1, ['rent1', 'rent3']),
      piece('half', 1, 2, ['rent2', 'agg2']),
      piece('none', 1, 3, []),
      piece('gone', 1, 4, ['deleted-cell']),
      piece('already', 1, 5, ['rent1'], true),
      piece('held-before', 1, 6, ['rent1'], false, true),
    ];
    expect(heldPieces(pieces, readings)).toEqual(['held']);
  });

  it('opens on the first piece in teaching order not passed', () => {
    const pieces = [piece('u2', 2, 1, []), piece('u1b', 1, 2, []), piece('u1a', 1, 1, [], true)];
    expect(firstNotHeld(pieces)?.id).toBe('u1b');
    expect(firstNotHeld([piece('x', 1, 1, [], true)])).toBeNull();
  });

  it('opens on unit 1 piece 1 when a placement held it (plan #2292.5)', () => {
    const pieces = [piece('u1b', 1, 2, ['rent1']), piece('u1a', 1, 1, ['rent1', 'rent3'], false, true)];
    expect(firstNotHeld(pieces)?.id).toBe('u1a');
  });
});

describe('placedTopics', () => {
  it('lists the topics answered on since the run began, at their level', () => {
    const m = map([RENT, AGG, ZONE], [
      { cellId: 'rent3', verdict: 'met', observedAt: START },
      { cellId: 'agg5', verdict: 'not_met', observedAt: START },
      { cellId: 'zone2', verdict: 'met', observedAt: '2026-10-01T10:00:00Z' },
    ]);
    expect(placedTopics(m, readCells(m), ['agg', 'rent', 'zone'], START)).toEqual([
      { topicId: 'agg', name: 'Agglomeration', level: 0 },
      { topicId: 'rent', name: 'Bid-rent curves', level: 3 },
    ]);
  });
});
