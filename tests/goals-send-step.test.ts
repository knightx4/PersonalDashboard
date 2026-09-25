/**
 * Send on a goal step or phase (plan #1000): the hand-over reads the goal's
 * tree, refuses what may not be sent, and otherwise writes one run row and
 * fires the goals routine with a brief that names the step.
 *
 * The client is a stand-in that answers each table's query from a fixture and
 * records every insert, update and filter, as in goals-reshape-run.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { sendGoalStep } from '@/lib/goals/handover-store';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-10-01T12:00:00Z');

type Fixture = {
  items: Record<string, unknown>[];
  approvedAt?: string | null;
  runs?: Record<string, unknown>[];
};

function fakeClient(fixture: Fixture) {
  const calls: { table: string; op: string; values: unknown; filters: unknown[][] }[] = [];

  function query(table: string) {
    const call = { table, op: 'select', values: null as unknown, filters: [] as unknown[][] };
    let one = false;
    calls.push(call);
    const result = () => {
      if (call.op === 'insert') return { data: { id: 'run-1' }, error: null };
      if (call.op === 'update') return { data: null, error: null };
      if (table === 'runs') return { data: fixture.runs ?? [], error: null };
      if (table === 'areas') return { data: [{ id: 'area', name: 'Money' }], error: null };
      if (table === 'dependencies' || table === 'collections') return { data: [], error: null };
      if (one) return { data: { approved_at: fixture.approvedAt ?? null }, error: null };
      return { data: fixture.items, error: null };
    };
    const builder: Record<string, unknown> = {
      insert(v: unknown) {
        call.op = 'insert';
        call.values = v;
        return builder;
      },
      update(v: unknown) {
        call.op = 'update';
        call.values = v;
        return builder;
      },
      maybeSingle() {
        one = true;
        return builder;
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve);
      },
    };
    for (const name of ['eq', 'is', 'in', 'not', 'gte']) {
      builder[name] = (...args: unknown[]) => {
        call.filters.push([name, ...args]);
        return builder;
      };
    }
    for (const name of ['select', 'order', 'limit', 'single']) {
      builder[name] = () => builder;
    }
    return builder;
  }

  return { client: { from: query } as unknown as GoalsSupabaseClient, calls };
}

function item(row: Record<string, unknown>) {
  return {
    area_id: null,
    parent_id: null,
    kind: null,
    status: 'open',
    detail: null,
    acceptance: null,
    fog: null,
    resolution: null,
    due_on: null,
    position: 10,
    rhythm_count: null,
    rhythm_period: null,
    on_todo: false,
    result: null,
    result_url: null,
    reviewed_at: null,
    unit: null,
    target: null,
    ...row,
  };
}

const ITEMS = [
  item({ id: 'g', level: 'goal', area_id: 'area', title: 'Pay off student debt' }),
  item({ id: 'p', level: 'step', parent_id: 'g', kind: 'mine', title: 'Get the numbers' }),
  item({
    id: 's',
    level: 'step',
    parent_id: 'p',
    kind: 'claude',
    title: 'List every loan with its rate',
    acceptance: 'A table of every loan, its balance and its rate.',
  }),
  item({ id: 'm', level: 'step', parent_id: 'p', kind: 'mine', title: 'Log in to Edfinancial', position: 20 }),
  item({
    id: 'q',
    level: 'step',
    parent_id: 'g',
    kind: 'decision',
    title: 'Avalanche or snowball?',
    position: 20,
  }),
  item({
    id: 'x',
    level: 'step',
    parent_id: 'g',
    kind: 'claude',
    status: 'proposed',
    title: 'Build the payoff schedule',
    position: 30,
  }),
];

const routine = { id: 'trig_goals', token: 'token' };
const APPROVED = '2026-09-30T10:00:00Z';

function okFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ claude_code_session_id: 'cse_1' }), { status: 200 }),
  );
}

async function send(stepId: string, fixture: Partial<Fixture> = {}) {
  const { client, calls } = fakeClient({ items: ITEMS, approvedAt: APPROVED, ...fixture });
  const fetch = okFetch();
  const result = await sendGoalStep({ client, userId: USER, stepId, routine, now: NOW, fetch });
  return { result, calls, fetch };
}

describe('sendGoalStep', () => {
  it('fires one step run whose brief names that step', async () => {
    const { result, calls, fetch } = await send('s');
    expect(result).toEqual({ ok: true, job: 'step', title: 'List every loan with its rate', runId: 'run-1' });

    const inserts = calls.filter((c) => c.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      table: 'runs',
      values: { user_id: USER, job: 'step', item_id: 's', status: 'started', routine_id: 'trig_goals' },
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const text = (JSON.parse(init.body as string) as { text: string }).text;
    expect(text).toContain('The step: "List every loan with its rate" (goals.items id s)');
    expect(text).toContain('Done when: A table of every loan, its balance and its rate.');
    expect(text).toContain('The goal: "Pay off student debt" (goals.items id g).');
    expect(text).toContain('Where the step sits: "Get the numbers".');
    expect(text).toContain('"Log in to Edfinancial"');
    expect(text).toContain('goals.runs id run-1');
  });

  it('fires a phase run on a step with sub-steps', async () => {
    const { result, calls } = await send('p');
    expect(result).toMatchObject({ ok: true, job: 'phase' });
    expect(calls.find((c) => c.op === 'insert')?.values).toMatchObject({ job: 'phase', item_id: 'p' });
  });

  it('refuses a question, a proposal and a step on an unapproved goal, and fires nothing', async () => {
    for (const [stepId, fixture, reason] of [
      ['q', {}, 'That is a question for you to answer, so there is nothing to send.'],
      ['x', {}, 'That step is still a proposal. Approve it, then send it.'],
      ['s', { approvedAt: null }, 'This goal is not approved yet. Approve it, then send its steps.'],
    ] as const) {
      const { result, calls, fetch } = await send(stepId, fixture);
      expect(result).toEqual({ ok: false, error: reason });
      expect(calls.some((c) => c.op === 'insert')).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it('refuses a step Claude is already on', async () => {
    const { result, fetch } = await send('s', {
      runs: [{ item_id: 's', job: 'step', created_at: '2026-10-01T11:30:00Z' }],
    });
    expect(result).toMatchObject({ ok: false });
    expect((result as { error: string }).error).toMatch(/already working on this step/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fires a prepare run on a step of yours (plan #1001)', async () => {
    const { client, calls } = fakeClient({ items: ITEMS, approvedAt: APPROVED });
    const fetch = okFetch();
    const result = await sendGoalStep({ client, userId: USER, stepId: 'm', routine, mode: 'prepare', now: NOW, fetch });
    expect(result).toEqual({ ok: true, job: 'prepare', title: 'Log in to Edfinancial', runId: 'run-1' });
    expect(calls.find((c) => c.op === 'insert')?.values).toMatchObject({ job: 'prepare', item_id: 'm' });
    // The step itself is not written: it stays yours and open until the run stores what it prepared.
    expect(calls.some((c) => c.op === 'update' && c.table === 'items')).toBe(false);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const text = (JSON.parse(init.body as string) as { text: string }).text;
    expect(text).toContain('The step: "Log in to Edfinancial" (goals.items id m)');
  });

  it('refuses to prepare a Claude step', async () => {
    const { client } = fakeClient({ items: ITEMS, approvedAt: APPROVED });
    const fetch = okFetch();
    const result = await sendGoalStep({ client, userId: USER, stepId: 's', routine, mode: 'prepare', now: NOW, fetch });
    expect(result).toEqual({ ok: false, error: 'Only a step of yours with no sub-steps can be prepared.' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('says so when the step is not on any live goal', async () => {
    const { result } = await send('gone');
    expect(result).toEqual({ ok: false, error: 'That step is no longer on the page.' });
  });
});
