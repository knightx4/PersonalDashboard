import { describe, expect, it } from 'vitest';
import {
  errandDueSoon,
  focusActive,
  FOCUS_SUGGESTED,
  inFocus,
  lastWeekOf,
  needsPlanning,
  overSuggested,
  plannable,
  weekOf,
} from './focus';
import type { Goal } from './tree';

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  return {
    id,
    areaId: 'area',
    title: `Goal ${id}`,
    acceptance: null,
    fog: null,
    status: 'open',
    position: 10,
    unit: null,
    target: null,
    ...extra,
  };
}

// A Tuesday.
const TODAY = '2026-10-06';

describe('focusActive', () => {
  it('is on when an open goal has focus', () => {
    expect(focusActive([goal('a'), goal('b', { focus: true })])).toBe(true);
  });

  it('is off when no goal has it, or only a goal that is not open', () => {
    expect(focusActive([goal('a'), goal('b')])).toBe(false);
    expect(focusActive([goal('a'), goal('p', { focus: true, status: 'parked' })])).toBe(false);
  });
});

describe('inFocus', () => {
  const errandSoon = goal('soon', { errand: true, dueOn: '2026-10-12' });
  const errandLate = goal('late', { errand: true, dueOn: '2026-10-01' });
  const errandFar = goal('far', { errand: true, dueOn: '2026-10-20' });

  it('counts every goal while none has focus', () => {
    const goals = [goal('a'), goal('b'), errandFar];
    for (const one of goals) expect(inFocus(one, goals, TODAY)).toBe(true);
  });

  it('counts focus goals and errands due within a week once focus is chosen', () => {
    const chosen = goal('a', { focus: true });
    const other = goal('b');
    const goals = [chosen, other, errandSoon, errandLate, errandFar];
    expect(inFocus(chosen, goals, TODAY)).toBe(true);
    expect(inFocus(other, goals, TODAY)).toBe(false);
    expect(inFocus(errandSoon, goals, TODAY)).toBe(true);
    expect(inFocus(errandLate, goals, TODAY)).toBe(true);
    expect(inFocus(errandFar, goals, TODAY)).toBe(false);
  });

  it('reads an errand by its flag alone when no day is given', () => {
    const goals = [goal('a', { focus: true }), errandSoon];
    expect(inFocus(errandSoon, goals)).toBe(false);
  });

  it('reads an errand due exactly a week out as due soon', () => {
    expect(errandDueSoon(goal('e', { errand: true, dueOn: '2026-10-13' }), TODAY)).toBe(true);
    expect(errandDueSoon(goal('e', { errand: true, dueOn: '2026-10-14' }), TODAY)).toBe(false);
    expect(errandDueSoon(goal('g', { dueOn: '2026-10-07' }), TODAY)).toBe(false);
  });
});

describe('weeks', () => {
  it('names the Monday of the week, and of the week before', () => {
    expect(weekOf(TODAY)).toBe('2026-10-05');
    expect(weekOf('2026-10-05')).toBe('2026-10-05');
    expect(weekOf('2026-10-11')).toBe('2026-10-05');
    expect(lastWeekOf(TODAY)).toBe('2026-09-28');
  });

  it('asks for a plan when never planned or planned in an earlier week', () => {
    expect(needsPlanning(null, TODAY)).toBe(true);
    expect(needsPlanning('2026-09-28', TODAY)).toBe(true);
    expect(needsPlanning('2026-10-05', TODAY)).toBe(false);
    expect(needsPlanning('2026-10-05', '2026-10-12')).toBe(true);
  });
});

describe('plannable', () => {
  it('offers open goals that are not errands', () => {
    const goals = [
      goal('a'),
      goal('e', { errand: true, dueOn: '2026-10-08' }),
      goal('p', { status: 'parked' }),
      goal('q', { status: 'proposed' }),
    ];
    expect(plannable(goals).map((g) => g.id)).toEqual(['a']);
  });
});

describe('the soft cap', () => {
  it('suggests three and allows more', () => {
    expect(FOCUS_SUGGESTED).toBe(3);
    expect(overSuggested(3)).toBe(false);
    expect(overSuggested(4)).toBe(true);
  });
});
