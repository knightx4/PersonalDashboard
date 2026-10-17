import { describe, expect, it } from 'vitest';
import { chooseTodaysPiece, nextUnfinishedPiece, type TodaysPieceGoal } from './todays-piece';

/**
 * Today's piece on Now (plan #2164.4): the next piece not passed and with no
 * right check, in the goal last worked, so finishing one shows the next.
 */

type State = 'open' | 'check' | 'passed';

function goal(id: string, units: State[][], lastWorked: string | null = null): TodaysPieceGoal {
  return {
    aimId: `aim-${id}`,
    name: `Goal ${id}`,
    subjectId: `s-${id}`,
    lastWorked,
    units: units.map((states, u) => ({
      id: `${id}-u${u + 1}`,
      ordinal: u + 1,
      pieces: states.map((state, p) => ({
        id: `${id}-u${u + 1}-p${p + 1}`,
        ordinal: p + 1,
        passed: state === 'passed',
        checkPassed: state === 'check',
      })),
    })),
  };
}

describe('nextUnfinishedPiece', () => {
  it('skips pieces passed or with their check answered right', () => {
    expect(nextUnfinishedPiece(goal('a', [['passed', 'check', 'open']]))).toBe('a-u1-p3');
  });

  it('goes on to the next unit, in ordinal order', () => {
    const g = goal('a', [['check'], ['open']]);
    expect(nextUnfinishedPiece({ ...g, units: [...g.units].reverse() })).toBe('a-u2-p1');
  });

  it('is null when every piece is finished', () => {
    expect(nextUnfinishedPiece(goal('a', [['passed', 'check']]))).toBeNull();
  });
});

describe('chooseTodaysPiece', () => {
  it('gives a piece of a subject that is no goal’s track', () => {
    const subject: TodaysPieceGoal = { ...goal('m', [['open']]), aimId: null, name: 'Music theory' };
    expect(chooseTodaysPiece([subject])).toMatchObject({ kind: 'piece', aimId: null, goalName: 'Music theory', pieceId: 'm-u1-p1' });
  });

  it('takes the oldest goal when none has been worked', () => {
    expect(chooseTodaysPiece([goal('a', [['open']]), goal('b', [['open']])])).toMatchObject({
      kind: 'piece',
      pieceId: 'a-u1-p1',
      goalName: 'Goal a',
    });
  });

  it('stays in the goal worked most recently', () => {
    const choice = chooseTodaysPiece([
      goal('a', [['open']], '2026-10-01T00:00:00Z'),
      goal('b', [['check', 'open']], '2026-10-10T00:00:00Z'),
    ]);
    expect(choice).toMatchObject({ kind: 'piece', pieceId: 'b-u1-p2' });
  });

  it('moves to another goal once the worked one is finished', () => {
    const choice = chooseTodaysPiece([
      goal('a', [['open']]),
      goal('b', [['check']], '2026-10-10T00:00:00Z'),
    ]);
    expect(choice).toMatchObject({ kind: 'piece', pieceId: 'a-u1-p1' });
  });

  it('leads with a pinned piece that is not finished', () => {
    const goals = [goal('a', [['open', 'open']]), goal('b', [['check', 'open']])];
    expect(chooseTodaysPiece(goals, 'b-u1-p2')).toMatchObject({ pieceId: 'b-u1-p2' });
    expect(chooseTodaysPiece(goals, 'b-u1-p1')).toMatchObject({ pieceId: 'a-u1-p1' });
  });

  it('points at a goal with no pieces written when nothing else is open', () => {
    expect(chooseTodaysPiece([goal('a', [['passed']]), goal('b', [[]])])).toEqual({
      kind: 'no-pieces',
      aimId: 'aim-b',
      goalName: 'Goal b',
      subjectId: 's-b',
    });
  });

  it('is null with no goals, or every goal finished', () => {
    expect(chooseTodaysPiece([])).toBeNull();
    expect(chooseTodaysPiece([goal('a', [['passed']])])).toBeNull();
  });
});
