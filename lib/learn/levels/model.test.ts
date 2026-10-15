import { describe, expect, it } from 'vitest';
import {
  dueRechecks,
  fringe,
  lensProgress,
  nextQuestion,
  questionFormat,
  readCells,
  topicLevel,
  type CellEvidence,
  type CellLink,
  type LevelCell,
  type LevelTopic,
  type TopicMap,
  type Verdict,
} from './model';

/**
 * The spec's own example, written by hand: CAPM 3 requires Return 2, Beta 2
 * and Risk-free rate 1, and Beta 2 requires Return 2. Cell ids are the topic
 * and the level, so `capm3` is CAPM level 3.
 */
const TOPICS: LevelTopic[] = [
  { id: 'capm', name: 'CAPM', ceiling: 10, approved: true },
  { id: 'return', name: 'Return', ceiling: 6, approved: true },
  { id: 'beta', name: 'Beta', ceiling: 5, approved: true },
  { id: 'rf', name: 'Risk-free rate', ceiling: 3, approved: true },
];

function cellsFor(topics: readonly LevelTopic[]): LevelCell[] {
  return topics.flatMap((t) =>
    Array.from({ length: t.ceiling }, (_, i) => ({ id: `${t.id}${i + 1}`, topicId: t.id, level: i + 1 })),
  );
}

const LINKS: CellLink[] = [
  { requiringCellId: 'capm3', requiredCellId: 'return2' },
  { requiringCellId: 'capm3', requiredCellId: 'beta2' },
  { requiringCellId: 'capm3', requiredCellId: 'rf1' },
  { requiringCellId: 'beta2', requiredCellId: 'return2' },
];

function ev(cellId: string, verdict: Verdict, observedAt = '2026-10-01T10:00:00Z'): CellEvidence {
  return { cellId, verdict, observedAt };
}

function map(evidence: CellEvidence[] = [], topics: LevelTopic[] = TOPICS): TopicMap {
  return { topics, cells: cellsFor(topics), links: LINKS, evidence };
}

function statusOf(m: TopicMap, ids: string[]): Record<string, string> {
  const readings = readCells(m);
  return Object.fromEntries(ids.map((id) => [id, readings.get(id)?.status ?? 'missing']));
}

describe('readCells', () => {
  it('reads every cell open on an empty map', () => {
    const readings = readCells(map());
    expect(readings.size).toBe(10 + 6 + 5 + 3);
    expect([...readings.values()].every((r) => r.status === 'open' && !r.inDoubt && r.heldSince === null)).toBe(
      true,
    );
  });

  it('reads nothing at all from a map with no topics', () => {
    const empty: TopicMap = { topics: [], cells: [], links: [], evidence: [] };
    const readings = readCells(empty);
    expect(readings.size).toBe(0);
    expect(fringe(empty, readings)).toEqual([]);
    expect(lensProgress(empty, readings, [])).toEqual({ held: 0, total: 0, fraction: 0, topics: [] });
  });

  it('implies the levels below and every cell down the links', () => {
    const m = map([ev('capm3', 'met')]);
    expect(statusOf(m, ['capm3', 'capm2', 'capm1', 'capm4'])).toEqual({
      capm3: 'shown',
      capm2: 'implied',
      capm1: 'implied',
      capm4: 'open',
    });
    // Down the links at the linked level, and the chain below them.
    expect(statusOf(m, ['return2', 'return1', 'return3', 'beta2', 'beta1', 'beta3', 'rf1', 'rf2'])).toEqual({
      return2: 'implied',
      return1: 'implied',
      return3: 'open',
      beta2: 'implied',
      beta1: 'implied',
      beta3: 'open',
      rf1: 'implied',
      rf2: 'open',
    });
  });

  it('carries a link from a cell up to every higher cell of its topic', () => {
    const m = map([ev('capm7', 'met')]);
    expect(statusOf(m, ['capm6', 'return2', 'rf1'])).toEqual({
      capm6: 'implied',
      return2: 'implied',
      rf1: 'implied',
    });
  });

  it('lets a cell\'s own miss beat implication, and puts the cell above it in doubt', () => {
    const m = map([ev('capm3', 'met', '2026-10-01T10:00:00Z'), ev('return2', 'not_met', '2026-10-02T10:00:00Z')]);
    const readings = readCells(m);
    expect(readings.get('return2')?.status).toBe('missed');
    // Return 1 is still under CAPM 3's cone.
    expect(readings.get('return1')?.status).toBe('implied');
    expect(readings.get('capm3')).toMatchObject({ status: 'shown', inDoubt: true, doubtedBy: ['return2'] });
    // Beta 2 is implied, not shown, so it is not in doubt.
    expect(readings.get('beta2')).toMatchObject({ status: 'implied', inDoubt: false });
    expect(nextQuestion(m, readings, 'capm')).toEqual({
      cellId: 'capm3',
      topicId: 'capm',
      level: 3,
      reason: 'doubt',
    });
  });

  it('reads the latest evidence on a cell', () => {
    const m = map([ev('return3', 'not_met', '2026-10-01T10:00:00Z'), ev('return3', 'met', '2026-10-05T10:00:00Z')]);
    expect(statusOf(m, ['return3'])).toEqual({ return3: 'shown' });
    const back = map([ev('return3', 'met', '2026-10-01T10:00:00Z'), ev('return3', 'not_met', '2026-10-05T10:00:00Z')]);
    expect(statusOf(back, ['return3', 'return2'])).toEqual({ return3: 'missed', return2: 'open' });
  });

  it('reads a declared cell as declared, and implies beneath it', () => {
    const m = map([ev('beta2', 'declared')]);
    expect(statusOf(m, ['beta2', 'beta1', 'return2', 'return1', 'capm3'])).toEqual({
      beta2: 'declared',
      beta1: 'implied',
      return2: 'implied',
      return1: 'implied',
      capm3: 'open',
    });
    expect(readCells(m).get('beta2')?.inDoubt).toBe(false);
  });

  it('ignores cells above the ceiling', () => {
    const cells = [...cellsFor(TOPICS), { id: 'rf9', topicId: 'rf', level: 9 }];
    const readings = readCells({ topics: TOPICS, cells, links: LINKS, evidence: [ev('rf9', 'met')] });
    expect(readings.has('rf9')).toBe(false);
    expect(readings.get('rf3')?.status).toBe('open');
  });
});

describe('topicLevel', () => {
  it('is the top of the unbroken run from level 1, with held cells above a gap listed', () => {
    const m = map([ev('return5', 'met'), ev('return3', 'not_met', '2026-10-03T00:00:00Z')]);
    expect(topicLevel(m, readCells(m), 'return')).toEqual({ topicId: 'return', level: 2, heldAboveGap: [4, 5] });
  });

  it('is zero on a topic with nothing held', () => {
    const m = map();
    expect(topicLevel(m, readCells(m), 'capm').level).toBe(0);
  });
});

describe('fringe', () => {
  it('on an empty map is level 1 of every topic, all wider', () => {
    const m = map();
    const rows = fringe(m, readCells(m));
    expect(rows.map((r) => r.cellId).sort()).toEqual(['beta1', 'capm1', 'return1', 'rf1']);
    expect(rows.every((r) => r.direction === 'wider' && r.status === 'open')).toBe(true);
  });

  it('holds back a cell whose required cells are not held', () => {
    const m = map([ev('capm2', 'met')]);
    const ids = fringe(m, readCells(m)).map((r) => r.cellId);
    // CAPM 3 needs Return 2, Beta 2 and Risk-free 1, none held.
    expect(ids).not.toContain('capm3');
    expect(ids).toContain('return1');
  });

  it('names deeper and wider, and counts what a cell unlocks', () => {
    const m = map([ev('return2', 'met'), ev('beta1', 'met')]);
    const rows = fringe(m, readCells(m));
    const byId = Object.fromEntries(rows.map((r) => [r.cellId, r]));
    expect(byId.return3.direction).toBe('deeper');
    expect(byId.rf1.direction).toBe('wider');
    // Beta 2 is ready (Beta 1 and Return 2 held) and unlocks Beta 3; CAPM 3
    // still waits on Risk-free 1.
    expect(byId.beta2.unlocks).toBe(1);
    // Ranked by what it unlocks once nothing else separates them.
    expect(rows[0].unlocks).toBeGreaterThanOrEqual(rows[rows.length - 1].unlocks);
  });

  it('puts a missed cell that is ready first, then a lens below its target', () => {
    const m = map([ev('return1', 'met'), ev('return2', 'not_met')]);
    const rows = fringe(m, readCells(m), { lensTargets: new Map([['rf', 3]]) });
    // The miss comes back before anything untouched, the lens included.
    expect(rows[0]).toMatchObject({ cellId: 'return2', status: 'missed' });
    expect(rows[1]).toMatchObject({ cellId: 'rf1', inLens: true });
  });

  it('leaves out draft topics', () => {
    const topics = TOPICS.map((t) => (t.id === 'rf' ? { ...t, approved: false } : t));
    const m = map([], topics);
    expect(fringe(m, readCells(m)).map((r) => r.cellId)).not.toContain('rf1');
    expect(nextQuestion(m, readCells(m), 'rf')).toBeNull();
  });
});

describe('nextQuestion', () => {
  it('places by bisection, starting halfway up', () => {
    const empty = map();
    expect(nextQuestion(empty, readCells(empty), 'capm')).toMatchObject({ level: 5, reason: 'placement' });

    const met5 = map([ev('capm5', 'met')]);
    expect(nextQuestion(met5, readCells(met5), 'capm')).toMatchObject({ level: 8, reason: 'placement' });

    const missed8 = map([ev('capm5', 'met'), ev('capm8', 'not_met')]);
    expect(nextQuestion(missed8, readCells(missed8), 'capm')).toMatchObject({ level: 6, reason: 'placement' });
  });

  it('stops placing once the gap is one, and asks the cell that settles most', () => {
    const m = map([ev('return2', 'met'), ev('return3', 'not_met')]);
    const q = nextQuestion(m, readCells(m), 'return');
    expect(q?.reason).toBe('settle');
    expect(q?.level).toBeGreaterThanOrEqual(3);
  });

  it('has nothing to ask on a topic held to its ceiling', () => {
    const m = map([ev('rf3', 'met')]);
    expect(nextQuestion(m, readCells(m), 'rf')).toBeNull();
  });
});

describe('dueRechecks', () => {
  it('asks the highest held cell of a topic not evidenced in thirty days', () => {
    const m = map([ev('capm3', 'met', '2026-08-01T00:00:00Z'), ev('beta2', 'met', '2026-10-10T00:00:00Z')]);
    const due = dueRechecks(m, readCells(m), new Date('2026-10-15T00:00:00Z'));
    // CAPM 3 is old; Return 2 is held only through CAPM 3 and Beta 2, and
    // Beta 2's newer answer holds it, so Return is not due. Risk-free 1 is.
    expect(due.map((d) => d.cellId)).toEqual(['capm3', 'rf1']);
  });
});

describe('lensProgress', () => {
  it('counts held cells at or below each target', () => {
    const m = map([ev('capm3', 'met')]);
    const p = lensProgress(m, readCells(m), [
      { topicId: 'capm', targetLevel: 6 },
      { topicId: 'return', targetLevel: 4 },
    ]);
    expect(p.topics).toEqual([
      { topicId: 'capm', targetLevel: 6, level: 3, held: 3, total: 6 },
      { topicId: 'return', targetLevel: 4, level: 2, held: 2, total: 4 },
    ]);
    expect(p.fraction).toBe(5 / 10);
  });
});

describe('questionFormat', () => {
  it('asks a case at 4 to 6, a defence at 10 and an explanation elsewhere', () => {
    expect([1, 3, 4, 6, 7, 9, 10].map(questionFormat)).toEqual([
      'explain',
      'explain',
      'case',
      'case',
      'explain',
      'explain',
      'defend',
    ]);
  });
});
