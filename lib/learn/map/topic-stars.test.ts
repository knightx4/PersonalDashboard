import { describe, expect, it } from 'vitest';
import type { CellReading, Readings } from '@/lib/learn/levels/model';
import { levelsText, stateForShare, topicStanding } from './topic-stars';

const reading = (topicId: string, level: number, status: CellReading['status'], heldSince: string | null): CellReading =>
  ({ cellId: `${topicId}-${level}`, topicId, level, status, inDoubt: false, doubtedBy: [], heldSince }) as CellReading;

const readings = (...rows: CellReading[]): Readings => new Map(rows.map((r) => [r.cellId, r]));

describe('topicStanding (plan #2317.2)', () => {
  it('reads a tested row from the highest level an answer showed', () => {
    const { stateRow, levels } = topicStanding(
      't',
      10,
      readings(
        reading('t', 1, 'implied', '2026-10-02T00:00:00Z'),
        reading('t', 3, 'shown', '2026-10-05T00:00:00Z'),
        reading('t', 6, 'implied', '2026-10-09T00:00:00Z'),
        reading('other', 9, 'shown', '2026-10-09T00:00:00Z'),
      ),
    );
    expect(levels).toEqual({ tested: 3, held: 6, ceiling: 10 });
    expect(stateRow).toEqual({
      state: 'recognised',
      established: 'tested',
      tested_at: '2026-10-05T00:00:00Z',
      declared_at: null,
      review_interval_days: null,
    });
  });

  it('reads an untested row from a level held by inference or your word', () => {
    const inferred = topicStanding('t', 4, readings(reading('t', 2, 'implied', '2026-10-03T00:00:00Z')));
    expect(inferred.stateRow).toMatchObject({ state: 'known', established: 'inferred', tested_at: null, declared_at: '2026-10-03T00:00:00Z' });
    const declared = topicStanding('t', 4, readings(reading('t', 4, 'declared', '2026-10-03T00:00:00Z')));
    expect(declared.stateRow).toMatchObject({ state: 'sharp', established: 'declared' });
  });

  it('has no row for a topic with nothing held, even with a level missed', () => {
    const { stateRow, levels } = topicStanding('t', 10, readings(reading('t', 2, 'missed', null), reading('t', 1, 'open', null)));
    expect(stateRow).toBeNull();
    expect(levels).toEqual({ tested: 0, held: 0, ceiling: 10 });
  });
});

describe('stateForShare', () => {
  it('climbs with the share of the ladder held', () => {
    expect(stateForShare(0.1)).toBe('recognised');
    expect(stateForShare(0.5)).toBe('known');
    expect(stateForShare(0.9)).toBe('sharp');
  });
});

describe('levelsText', () => {
  it('says the level held and how much of it is tested', () => {
    expect(levelsText({ tested: 0, held: 0, ceiling: 10 })).toBe('None of 10 held');
    expect(levelsText({ tested: 4, held: 4, ceiling: 10 })).toBe('4 of 10 held, all tested');
    expect(levelsText({ tested: 2, held: 4, ceiling: 10 })).toBe('4 of 10 held, 2 tested');
    expect(levelsText({ tested: 0, held: 3, ceiling: 10 })).toBe('3 of 10 held, none tested');
  });
});
