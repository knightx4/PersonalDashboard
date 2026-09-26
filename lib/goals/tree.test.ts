import { describe, expect, it } from 'vitest';
import {
  GOAL_TITLE_MAX,
  groupGoals,
  nextPosition,
  parseAreaName,
  parseAreaNote,
  readsAsPractice,
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

describe('a goal is an outcome, not a practice', () => {
  it('reads rates and streaks as practices', () => {
    for (const text of [
      'Go to one urbanism event a week',
      'Kept for eight of the last ten weeks',
      'Apply to roles every week',
      'Run three times a week',
      'Weekly date night',
      'Log the balance monthly',
      'Send 5 applications per week',
    ]) {
      expect(readsAsPractice(text), text).toBe(true);
    }
  });

  it('leaves outcomes alone, including ones with numbers and dates', () => {
    for (const text of [
      'Know ten people in the scene by name',
      'Pay off student debt',
      'You have attended six full board meetings and spoken at one.',
      'Bench 200 lbs by March',
      'Every card at a zero balance.',
      'Land your next role',
      'Find a gym within a week',
      'Move in a month',
    ]) {
      expect(readsAsPractice(text), text).toBe(false);
    }
  });

  it('refuses a practice as a goal title or done-when, with the way to fix it', () => {
    const get = (fields: Record<string, string>) => (key: string) => fields[key] ?? null;
    const title = parseGoalFields(get({ title: 'Go to one event a week' }));
    expect(title.ok).toBe(false);
    expect(!title.ok && title.error).toMatch(/rhythm step/);
    expect(parseGoalFields(get({ acceptance: 'Kept for 8 of 10 weeks' })).ok).toBe(false);
    expect(parseGoalFields(get({ fog: 'Maybe once a week, maybe more' })).ok).toBe(true);
  });
});

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
