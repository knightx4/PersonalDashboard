import { describe, expect, it, vi } from 'vitest';
import { parseRef } from '@/lib/core/refs';
import { buildForest, type Step } from '@/lib/goals/steps';
import type { Goal } from '@/lib/goals/tree';

/**
 * What the goals wait on you for, on the agenda (plan #1473): goals and steps
 * Dash proposed, and steps blocked on you. Each leaves the list when its move
 * changes: approved, or unblocked.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/todo/agenda/clients', () => ({ sessionClients: {} }));
vi.mock('@/lib/todo/agenda/dismissals', () => ({ dismiss: vi.fn() }));
vi.mock('@/lib/goals/steps-store', () => ({ loadLiveTree: vi.fn() }));

const { goalWaitingItems } = await import('./goal-waiting');

const TODAY = '2026-10-03';

function goal(id: string, extra: Partial<Goal> = {}): { goal: Goal; areaName: string } {
  return {
    goal: {
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
    },
    areaName: 'Money',
  };
}

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
    createdAt: '2026-10-01T09:00:00.000Z',
    ...extra,
  };
}

function items(goals: ReturnType<typeof goal>[], steps: Step[]) {
  const { byGoal } = buildForest(
    goals.map((g) => g.goal.id),
    steps,
  );
  return goalWaitingItems(goals, byGoal, TODAY);
}

describe('goalWaitingItems', () => {
  it('lists a goal Dash proposed until it is approved', () => {
    const [item] = items([goal('g1', { status: 'proposed' })], []);
    expect(item).toMatchObject({
      key: 'goal_waiting:plan:area:1',
      source: 'goal_waiting',
      ref: 'goals.items:g1',
      title: 'Approve the goal Dash proposed: Goal g1',
      link: { href: '/goals/g1', label: 'Goal g1' },
      completable: false,
    });
    expect(parseRef(item.ref)).not.toBeNull();
    expect(items([goal('g1')], [])).toEqual([]);
  });

  it('lists the steps Dash proposed under a goal as one item until they are approved', () => {
    const proposed = items([goal('g1')], [step('s1', 'g1', { status: 'proposed' }), step('s2', 'g1', { status: 'proposed' })]);
    expect(proposed.map((item) => [item.key, item.title])).toEqual([
      ['goal_waiting:breakdown:g1:2', 'Approve 2 steps Dash proposed for Goal g1'],
    ]);
    expect(items([goal('g1')], [step('s1', 'g1'), step('s2', 'g1')])).toEqual([]);
  });

  it('lists a step blocked on you with what it needs, until the block lifts', () => {
    const blocked = step('s1', 'g1', { status: 'blocked', blockKind: 'outside', blockAsk: 'Send the form.' });
    const [item] = items([goal('g1')], [blocked]);
    expect(item).toMatchObject({
      key: 'goal_waiting:blocked:s1',
      ref: 'goals.items:s1',
      title: 's1',
      detail: 'Needs: Send the form.',
      onYouSince: '2026-10-01T09:00:00.000Z',
      link: { href: '/goals/g1#step-s1', label: 'Goal g1' },
    });
    expect(items([goal('g1')], [step('s1', 'g1')])).toEqual([]);
  });

  it('leaves a question to the goal steps source', () => {
    expect(items([goal('g1')], [step('q1', 'g1', { kind: 'decision' })])).toEqual([]);
  });
});
