import { describe, expect, it } from 'vitest';
import {
  buildForest,
  countSteps,
  describeRhythm,
  markStartDates,
  parseStepFields,
  type Step,
} from './steps';

function step(id: string, parentId: string, extra: Partial<Step> = {}): Step {
  return {
    id,
    parentId,
    kind: 'mine',
    status: 'open',
    title: id,
    detail: null,
    acceptance: null,
    resolution: null,
    dueOn: null,
    position: 10,
    rhythmCount: null,
    rhythmPeriod: null,
    onTodo: false,
    result: null,
    resultUrl: null,
    reviewedAt: null,
    ...extra,
  };
}

const form = (values: Record<string, string>) => (key: string) => values[key] ?? null;

describe('buildForest', () => {
  it('nests steps under steps to any depth, in the order given', () => {
    const { byGoal, goalOf } = buildForest(
      ['g1', 'g2'],
      [step('a', 'g1'), step('b', 'g1'), step('a1', 'a'), step('a1x', 'a1'), step('c', 'g2')],
    );
    const tree = byGoal.get('g1') ?? [];
    expect(tree.map((n) => n.id)).toEqual(['a', 'b']);
    expect(tree[0].children[0].children[0].id).toBe('a1x');
    expect(goalOf.get('a1x')).toBe('g1');
    expect(byGoal.get('g2')?.map((n) => n.id)).toEqual(['c']);
  });

  it('leaves out a branch whose parent is not live', () => {
    // `gone` is archived, so it is not among the rows, and neither is what hangs under it.
    const { byGoal, nodes } = buildForest(['g1'], [step('a', 'g1'), step('orphan', 'gone')]);
    expect(byGoal.get('g1')?.map((n) => n.id)).toEqual(['a']);
    expect(nodes.has('orphan')).toBe(false);
  });

  it('gives a goal with no steps an empty list', () => {
    expect(buildForest(['g1'], []).byGoal.get('g1')).toEqual([]);
  });
});

describe('markStartDates', () => {
  it('marks a step whose start is ahead, and what is under it with the later of the two', () => {
    const { byGoal, nodes } = buildForest(
      ['g'],
      [
        step('nov', 'g', { startsOn: '2026-11-01' }),
        step('dec', 'nov', { startsOn: '2026-12-01' }),
        step('oct', 'nov', { startsOn: '2026-10-01' }),
        step('past', 'g', { startsOn: '2026-09-01' }),
      ],
    );
    markStartDates(byGoal, '2026-09-26');
    expect(nodes.get('nov')?.waitsUntil).toBe('2026-11-01');
    expect(nodes.get('dec')?.waitsUntil).toBe('2026-12-01');
    expect(nodes.get('oct')?.waitsUntil).toBe('2026-11-01');
    expect(nodes.get('past')?.waitsUntil).toBeUndefined();

    markStartDates(byGoal, '2026-11-01');
    expect(nodes.get('nov')?.waitsUntil).toBeUndefined();
    expect(nodes.get('dec')?.waitsUntil).toBe('2026-12-01');
  });
});

describe('countSteps', () => {
  it('counts every level and treats done and dropped as closed', () => {
    const { byGoal } = buildForest(
      ['g'],
      [step('a', 'g', { status: 'done' }), step('a1', 'a', { status: 'dropped' }), step('a2', 'a')],
    );
    expect(countSteps(byGoal.get('g') ?? [])).toEqual({ total: 3, closed: 2 });
  });
});

describe('describeRhythm', () => {
  it('reads as a person would say it', () => {
    expect(describeRhythm(1, 'week')).toBe('Once a week');
    expect(describeRhythm(2, 'day')).toBe('Twice a day');
    expect(describeRhythm(3, 'month')).toBe('3 a month');
  });
});

describe('parseStepFields', () => {
  it('requires a title for a new step and leaves absent fields alone', () => {
    expect(parseStepFields(form({}), { requireTitle: true })).toMatchObject({ ok: false });
    expect(parseStepFields(form({ title: '  Call the bank ' }))).toEqual({
      ok: true,
      value: { title: 'Call the bank' },
    });
  });

  it('clears a detail, done-when or due date sent empty', () => {
    expect(parseStepFields(form({ detail: '', acceptance: ' ', dueOn: '' }))).toEqual({
      ok: true,
      value: { detail: null, acceptance: null, due_on: null },
    });
  });

  it('takes a start date, and refuses one after the due date', () => {
    expect(parseStepFields(form({ startsOn: '2026-11-01', dueOn: '2026-12-01' }))).toEqual({
      ok: true,
      value: { starts_on: '2026-11-01', due_on: '2026-12-01' },
    });
    expect(parseStepFields(form({ startsOn: '' }))).toEqual({ ok: true, value: { starts_on: null } });
    expect(parseStepFields(form({ startsOn: '2026-12-02', dueOn: '2026-12-01' })).ok).toBe(false);
    expect(parseStepFields(form({ startsOn: '2026-13-01' })).ok).toBe(false);
  });

  it('refuses a date that is not one', () => {
    expect(parseStepFields(form({ dueOn: '2026-02-30' })).ok).toBe(false);
    expect(parseStepFields(form({ dueOn: '2026-10-01' }))).toEqual({
      ok: true,
      value: { due_on: '2026-10-01' },
    });
  });

  it('needs a count for a rhythm, defaults it to weekly, and clears it for other kinds', () => {
    expect(parseStepFields(form({ kind: 'rhythm' })).ok).toBe(false);
    expect(parseStepFields(form({ kind: 'rhythm', rhythmCount: '1' }))).toEqual({
      ok: true,
      value: { kind: 'rhythm', rhythm_count: 1, rhythm_period: 'week' },
    });
    expect(parseStepFields(form({ kind: 'claude', rhythmCount: '3' }))).toEqual({
      ok: true,
      value: { kind: 'claude', rhythm_count: null, rhythm_period: null },
    });
  });

  it('refuses an unknown kind, a count out of range, and an unknown period', () => {
    expect(parseStepFields(form({ kind: 'someone' })).ok).toBe(false);
    expect(parseStepFields(form({ kind: 'rhythm', rhythmCount: '0' })).ok).toBe(false);
    expect(parseStepFields(form({ kind: 'rhythm', rhythmCount: '1.5' })).ok).toBe(false);
    expect(
      parseStepFields(form({ kind: 'rhythm', rhythmCount: '1', rhythmPeriod: 'year' })).ok,
    ).toBe(false);
  });
});
