import { describe, expect, it } from 'vitest';
import { pieceState, planFinished, planProgress, progressLine, type PieceState, type PlanUnit } from './plan-view';

/**
 * A learning goal's plan (plan #1143): progress is the pieces passed out of
 * those written, and Next up is the first piece not passed in the suggested
 * order, whatever was done out of order.
 */

function unit(ordinal: number, states: PieceState[]): PlanUnit {
  return {
    id: `u${ordinal}`,
    ordinal,
    title: `Unit ${ordinal}`,
    covers: null,
    outcome: null,
    pieces: states.map((state, index) => ({
      id: `u${ordinal}-p${index + 1}`,
      ordinal: index + 1,
      title: `Piece ${ordinal}.${index + 1}`,
      state,
    })),
  };
}

describe('planProgress', () => {
  it('counts the pieces passed out of every piece written', () => {
    const progress = planProgress([unit(1, ['passed', 'passed', 'open']), unit(2, ['open', 'open']), unit(3, [])]);
    expect(progress).toMatchObject({ passed: 2, total: 5, units: 3, unitsWritten: 2 });
  });

  it('makes the first piece not passed, in unit then piece order, next up', () => {
    const progress = planProgress([unit(2, ['open']), unit(1, ['passed', 'check', 'open'])]);
    expect(progress.next).toEqual({
      pieceId: 'u1-p2',
      title: 'Piece 1.2',
      state: 'check',
      unitId: 'u1',
      unitOrdinal: 1,
      unitTitle: 'Unit 1',
    });
  });

  it('brings a piece skipped earlier back as next once the later ones are passed', () => {
    const progress = planProgress([unit(1, ['open', 'passed']), unit(2, ['passed'])]);
    expect(progress.next?.pieceId).toBe('u1-p1');
  });

  it('has nothing next once every piece written is passed', () => {
    expect(planProgress([unit(1, ['passed']), unit(2, [])]).next).toBeNull();
    expect(planProgress([]).next).toBeNull();
  });
});

describe('pieceState', () => {
  it('reads passed first, then whichever half is done', () => {
    expect(pieceState({ passed: true, practicePassed: false, checkPassed: false })).toBe('passed');
    expect(pieceState({ passed: false, practicePassed: true, checkPassed: false })).toBe('practice');
    expect(pieceState({ passed: false, practicePassed: false, checkPassed: true })).toBe('check');
    expect(pieceState({ passed: false, practicePassed: false, checkPassed: false })).toBe('open');
  });
});

describe('progressLine', () => {
  it('says how many are passed and how many units are still to split', () => {
    expect(progressLine({ passed: 3, total: 24, units: 6, unitsWritten: 6 })).toBe('3 of 24 pieces passed');
    expect(progressLine({ passed: 0, total: 5, units: 4, unitsWritten: 1 })).toBe(
      '0 of 5 pieces passed · 3 units still to split',
    );
    expect(progressLine({ passed: 0, total: 0, units: 4, unitsWritten: 0 })).toBe('Pieces not written yet');
    expect(progressLine({ passed: 0, total: 0, units: 0, unitsWritten: 0 })).toBe('No units yet');
  });
});

describe('planFinished', () => {
  // plan #1146: the final project passed and every piece passed.
  const all = { passed: 24, total: 24, units: 6, unitsWritten: 6 };

  it('holds only when the project and every piece are passed', () => {
    expect(planFinished(all, true)).toBe(true);
    expect(planFinished(all, false)).toBe(false);
    expect(planFinished({ ...all, passed: 23 }, true)).toBe(false);
  });

  it('does not hold while a unit is not split into pieces, or with no pieces at all', () => {
    expect(planFinished({ passed: 20, total: 20, units: 6, unitsWritten: 5 }, true)).toBe(false);
    expect(planFinished({ passed: 0, total: 0, units: 0, unitsWritten: 0 }, true)).toBe(false);
  });

  it('is what the progress line says once it holds', () => {
    expect(progressLine(all, true)).toBe('Finished · 24 pieces and the final project passed');
  });
});
