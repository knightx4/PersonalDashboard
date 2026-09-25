import { describe, expect, it } from 'vitest';
import {
  GOAL_TITLE_MAX,
  groupGoals,
  nextPosition,
  parseAreaName,
  parseAreaNote,
  parseGoalFields,
  reorder,
  type Goal,
} from './tree';

const goal = (id: string, areaId: string): Goal => ({
  id,
  areaId,
  title: id,
  acceptance: null,
  fog: null,
  status: 'open',
  position: 0,
  unit: null,
  target: null,
});

const form = (values: Record<string, string>) => (key: string) => values[key] ?? null;

describe('parseAreaNote', () => {
  it('trims a note and clears an empty one', () => {
    expect(parseAreaNote('  Meet people in transit ')).toEqual({ ok: true, value: 'Meet people in transit' });
    expect(parseAreaNote('   ')).toEqual({ ok: true, value: null });
    expect(parseAreaNote('x'.repeat(4001)).ok).toBe(false);
  });
});

describe('parseAreaName', () => {
  it('trims a name and refuses an empty one', () => {
    expect(parseAreaName('  Money ')).toEqual({ ok: true, value: 'Money' });
    expect(parseAreaName('   ').ok).toBe(false);
    expect(parseAreaName(null).ok).toBe(false);
  });
});

describe('parseGoalFields', () => {
  it('takes a title with a done-when', () => {
    expect(
      parseGoalFields(form({ title: 'Pay off the debts', acceptance: 'Every card at zero' }), {
        requireTitle: true,
      }),
    ).toEqual({ ok: true, value: { title: 'Pay off the debts', acceptance: 'Every card at zero' } });
  });

  it('takes fog in place of a done-when', () => {
    expect(
      parseGoalFields(form({ title: 'Get fit', fog: 'Strength or endurance?' }), {
        requireTitle: true,
      }),
    ).toEqual({ ok: true, value: { title: 'Get fit', fog: 'Strength or endurance?' } });
  });

  it('refuses a new goal with no title', () => {
    expect(parseGoalFields(form({ acceptance: 'x' }), { requireTitle: true }).ok).toBe(false);
    expect(parseGoalFields(form({ title: ' ' }), { requireTitle: true }).ok).toBe(false);
  });

  it('clears a done-when or fog sent empty, and leaves absent fields alone', () => {
    expect(parseGoalFields(form({ fog: '  ' }))).toEqual({ ok: true, value: { fog: null } });
    expect(parseGoalFields(form({}))).toEqual({ ok: true, value: {} });
  });

  it('refuses a title over the limit', () => {
    expect(parseGoalFields(form({ title: 'x'.repeat(GOAL_TITLE_MAX + 1) })).ok).toBe(false);
  });
});

describe('reorder', () => {
  it('swaps a row with its neighbour', () => {
    expect(reorder(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c']);
    expect(reorder(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b']);
  });

  it('returns null at either end or for a row not in the list', () => {
    expect(reorder(['a', 'b'], 'a', 'up')).toBeNull();
    expect(reorder(['a', 'b'], 'b', 'down')).toBeNull();
    expect(reorder(['a', 'b'], 'z', 'up')).toBeNull();
  });
});

describe('nextPosition', () => {
  it('puts a new row after the last', () => {
    expect(nextPosition([])).toBe(10);
    expect(nextPosition([10, 40, 20])).toBe(50);
  });
});

describe('groupGoals', () => {
  it('keeps the areas in order and leaves out goals of unlisted areas', () => {
    const grouped = groupGoals(
      [
        { id: 'money', name: 'Money', note: null, position: 10 },
        { id: 'city', name: 'The city', note: null, position: 20 },
      ],
      [goal('debts', 'money'), goal('events', 'city'), goal('stray', 'gone')],
    );
    expect(grouped.map((area) => [area.id, area.goals.map((g) => g.id)])).toEqual([
      ['money', ['debts']],
      ['city', ['events']],
    ]);
  });
});
