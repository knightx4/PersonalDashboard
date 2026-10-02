import { describe, expect, it } from 'vitest';
import { canSetAside, setAsideFields, setAsideOn } from './set-aside';

// 2026-10-02 is a Friday.
describe('setAsideOn', () => {
  it('reads tomorrow as the next day, across a month', () => {
    expect(setAsideOn('tomorrow', '2026-10-02')).toBe('2026-10-03');
    expect(setAsideOn('tomorrow', '2026-10-31')).toBe('2026-11-01');
  });

  it('reads this weekend as the coming Saturday, a week on from a Saturday', () => {
    expect(setAsideOn('weekend', '2026-10-02')).toBe('2026-10-03');
    expect(setAsideOn('weekend', '2026-09-28')).toBe('2026-10-03');
    expect(setAsideOn('weekend', '2026-10-03')).toBe('2026-10-10');
    expect(setAsideOn('weekend', '2026-10-04')).toBe('2026-10-10');
  });

  it('reads next week as the coming Monday, a week on from a Monday', () => {
    expect(setAsideOn('next_week', '2026-10-02')).toBe('2026-10-05');
    expect(setAsideOn('next_week', '2026-10-04')).toBe('2026-10-05');
    expect(setAsideOn('next_week', '2026-10-05')).toBe('2026-10-12');
  });

  it('reads next month as its first day, across a year', () => {
    expect(setAsideOn('next_month', '2026-10-02')).toBe('2026-11-01');
    expect(setAsideOn('next_month', '2026-12-31')).toBe('2027-01-01');
  });
});

describe('setAsideFields', () => {
  it('sets the start date and leaves a later due date alone', () => {
    expect(setAsideFields({ dueOn: '2026-10-20' }, '2026-10-05')).toEqual({
      starts_on: '2026-10-05',
      dueMoved: false,
    });
    expect(setAsideFields({ dueOn: null }, '2026-10-05')).toEqual({
      starts_on: '2026-10-05',
      dueMoved: false,
    });
  });

  it('moves a due date that falls before the start along with it', () => {
    expect(setAsideFields({ dueOn: '2026-10-02' }, '2026-10-05')).toEqual({
      starts_on: '2026-10-05',
      due_on: '2026-10-05',
      dueMoved: true,
    });
  });
});

describe('canSetAside', () => {
  it('takes the kinds that are a step, and nothing else', () => {
    for (const kind of ['step', 'question', 'ask', 'rhythm'] as const) {
      expect(canSetAside(kind)).toBe(true);
    }
    for (const kind of ['flag', 'went', 'suggestion', 'breakdown', 'plan', 'close', 'park'] as const) {
      expect(canSetAside(kind)).toBe(false);
    }
  });
});
