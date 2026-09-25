/**
 * The re-shape tick (plan #1017): it reads the answers from goals.history and
 * fires the goals routine once per goal whose answers have settled.
 *
 * The client is a stand-in that answers each table's query from a fixture and
 * records every insert, update and filter, as in goals-weekly-run.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { runGoalsReshape } from '@/inngest/goals/reshape';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-10-01T12:00:00Z');

type Fixture = {
  answers: Record<string, unknown>[];
  runs?: Record<string, unknown>[];
  items: Record<string, unknown>[];
};

function fakeClient(fixture: Fixture) {
  const calls: { table: string; op: string; values: unknown; filters: unknown[][] }[] = [];

  function query(table: string) {
    const call = { table, op: 'select', values: null as unknown, filters: [] as unknown[][] };
    calls.push(call);
    const result = () => {
      if (call.op === 'insert') return { data: { id: 'run-1' }, error: null };
      if (call.op === 'update') return { data: null, error: null };
      if (table === 'history') return { data: fixture.answers, error: null };
      if (table === 'runs') return { data: fixture.runs ?? [], error: null };
      if (table === 'areas') return { data: [{ id: 'area', name: 'Money' }], error: null };
      if (table === 'dependencies') return { data: [], error: null };
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

  const client = {
    from: query,
    schema: () => ({ rpc: async () => ({ data: { userId: USER, email: 'o@example.test' }, error: null }) }),
  } as unknown as GoalsSupabaseClient;
  return { client, calls };
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
  item({
    id: 'q',
    level: 'step',
    parent_id: 'g',
    kind: 'decision',
    status: 'done',
    title: 'Avalanche or snowball?',
    resolution: 'A — Avalanche.',
  }),
  item({
    id: 's',
    level: 'step',
    parent_id: 'g',
    kind: 'claude',
    status: 'proposed',
    title: 'Build the payoff schedule',
    detail: 'Provisional: depends on "Avalanche or snowball?".',
  }),
];

const routine = { id: 'trig_goals', token: 'token' };

function okFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ claude_code_session_id: 'cse_1' }), { status: 200 }),
  );
}

describe('runGoalsReshape', () => {
  it('starts nothing when the goals routine is not set', async () => {
    const { client, calls } = fakeClient({ answers: [], items: ITEMS });
    const result = await runGoalsReshape({ client, routine: { id: null, token: null }, now: NOW });
    expect(result).toEqual({ skipped: 'CLAUDE_GOALS_ROUTINE_ID is not set' });
    expect(calls).toEqual([]);
  });

  it('reads answers from history and fires one reshape run for the goal', async () => {
    const { client, calls } = fakeClient({
      answers: [{ row_id: 'q', created_at: '2026-10-01T11:45:00Z' }],
      items: ITEMS,
    });
    const fetch = okFetch();
    const result = await runGoalsReshape({ client, routine, now: NOW, fetch });
    expect(result).toEqual({ started: ['run-1'], failed: [], held: 0 });

    const history = calls.find((c) => c.table === 'history');
    expect(history?.filters).toContainEqual(['eq', 'user_id', USER]);
    expect(history?.filters).toContainEqual(['eq', 'action', 'update']);
    expect(history?.filters).toContainEqual(['not', 'new_values->resolution', 'is', null]);

    const insert = calls.find((c) => c.op === 'insert');
    expect(insert).toMatchObject({
      table: 'runs',
      values: { user_id: USER, job: 'reshape', item_id: 'g', status: 'started', routine_id: 'trig_goals' },
    });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/routines/trig_goals/fire');
    const text = (JSON.parse(init.body as string) as { text: string }).text;
    expect(text).toContain('goals.runs id run-1');
    expect(text).toContain('"Build the payoff schedule" (goals.items id s), proposed');
  });

  it('waits for an answer given in the last ten minutes', async () => {
    const { client, calls } = fakeClient({
      answers: [{ row_id: 'q', created_at: '2026-10-01T11:55:00Z' }],
      items: ITEMS,
    });
    const fetch = okFetch();
    const result = await runGoalsReshape({ client, routine, now: NOW, fetch });
    expect(result).toEqual({ skipped: 'no goal has an answer waiting to be worked in' });
    expect(calls.some((c) => c.op === 'insert')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads history once and fires nothing when nothing was answered', async () => {
    const { client, calls } = fakeClient({ answers: [], items: ITEMS });
    const fetch = okFetch();
    const result = await runGoalsReshape({ client, routine, now: NOW, fetch });
    expect(result).toEqual({ skipped: 'no questions answered lately' });
    expect(calls.map((c) => c.table)).toEqual(['history']);
    expect(fetch).not.toHaveBeenCalled();
  });
});
