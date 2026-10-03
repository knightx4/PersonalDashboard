import { describe, expect, it, vi } from 'vitest';
import { parseRef } from '@/lib/core/refs';
import { planItemFromRow, type PlanData } from '@/lib/plan/load';

/**
 * Plan rows on the agenda (plan #1473): each row whose move is on you is an
 * item, and it leaves the list when the move changes. Over planStepItems, the
 * pure half of the source, so a fixture plan stands in for the database.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/todo/agenda/clients', () => ({ sessionClients: {} }));
vi.mock('@/lib/todo/agenda/dismissals', () => ({ dismiss: vi.fn() }));

const { planStepItems } = await import('./plan-steps');

function row(id: string, number: number, extra: Record<string, unknown> = {}) {
  return planItemFromRow({
    id,
    number,
    title: `Step ${number}`,
    status: 'not_started',
    kind: 'build',
    module: 'todo',
    parent_id: null,
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-02T09:00:00.000Z',
    ...extra,
  });
}

function plan(...items: ReturnType<typeof row>[]): PlanData {
  return { items, dependencies: [] };
}

const keys = (data: PlanData) => planStepItems(data).map((item) => item.key);

describe('planStepItems', () => {
  it('leaves off a ready step, which is nobody waiting on you', () => {
    expect(planStepItems(plan(row('a', 1)))).toEqual([]);
  });

  it('lists a question until it is answered', () => {
    const open = row('q', 2, { kind: 'decision', title: 'Which shape?', detail: 'A — one. B — two.' });
    const [item] = planStepItems(plan(open));
    expect(item).toMatchObject({
      key: 'plan_steps:q:unanswered',
      source: 'plan_steps',
      ref: 'public.plan_items:q',
      title: 'Which shape?',
      day: null,
      onYouSince: '2026-10-01T09:00:00.000Z',
      completable: false,
    });
    expect(parseRef(item.ref)).not.toBeNull();

    const answered = row('q', 2, { kind: 'decision', status: 'done', resolution: 'A' });
    expect(planStepItems(plan(answered))).toEqual([]);
  });

  it('lists a proposed feature once, counting the proposed steps under it, until approved', () => {
    const feature = row('f', 3, { status: 'proposed', title: 'Export' });
    const child = row('c', 4, { status: 'proposed', parent_id: 'f' });
    const items = planStepItems(plan(feature, child));
    expect(items.map((item) => item.key)).toEqual(['plan_steps:f:proposed']);
    expect(items[0].title).toBe('Approve #3: Export');
    expect(items[0].detail).toBe('Proposed, with 1 step under it');

    expect(
      keys(plan(row('f', 3, { title: 'Export' }), row('c', 4, { parent_id: 'f' }))),
    ).toEqual([]);
  });

  it('lists a step blocked on you with what it needs, until the block lifts', () => {
    const blocked = row('b', 5, { status: 'blocked', block_kind: 'outside', block_ask: 'Set the token.' });
    const [item] = planStepItems(plan(blocked));
    expect(item.key).toBe('plan_steps:b:blocked');
    expect(item.detail).toBe('Needs: Set the token.');
    expect(item.onYouSince).toBe('2026-10-02T09:00:00.000Z');

    expect(keys(plan(row('b', 5)))).toEqual([]);
  });

  it('lists a setup job of yours until it is done', () => {
    expect(keys(plan(row('s', 6, { kind: 'setup', assignee: 'me' })))).toEqual(['plan_steps:s:setup']);
    expect(keys(plan(row('s', 6, { kind: 'setup', assignee: 'me', status: 'done' })))).toEqual([]);
  });

  it('leaves off a dismissed question', () => {
    const aside = row('q', 7, { kind: 'decision', dismissed_at: '2026-10-02T00:00:00.000Z' });
    expect(keys(plan(aside))).toEqual([]);
  });
});
