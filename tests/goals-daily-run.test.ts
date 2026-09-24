/**
 * The morning goals run, as the daily cron calls it (plan #933): it fires the
 * goals routine once, with the run row written first, and only when there is
 * a Claude step to work and no morning run already today.
 *
 * The client is a stand-in that answers each table's query from a fixture and
 * records every insert and update, so what the run writes is checked without
 * a database.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { runGoalsDaily } from '@/inngest/goals/daily';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-09-24T12:00:00Z');

type Fixture = {
  lastDailyRun?: string | null;
  items: Record<string, unknown>[];
};

function fakeClient(fixture: Fixture) {
  const writes: { table: string; op: string; values: unknown }[] = [];

  function query(table: string) {
    let op = 'select';
    let values: unknown = null;
    const result = () => {
      if (op === 'insert') return { data: { id: 'run-1' }, error: null };
      if (op === 'update') return { data: null, error: null };
      if (table === 'runs') {
        return {
          data: fixture.lastDailyRun ? [{ created_at: fixture.lastDailyRun }] : [],
          error: null,
        };
      }
      if (table === 'areas') return { data: [{ id: 'area', name: 'Money' }], error: null };
      return { data: fixture.items, error: null };
    };
    const builder: Record<string, unknown> = {
      insert(v: unknown) {
        op = 'insert';
        values = v;
        writes.push({ table, op, values });
        return builder;
      },
      update(v: unknown) {
        op = 'update';
        values = v;
        writes.push({ table, op, values });
        return builder;
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve);
      },
    };
    for (const name of ['select', 'eq', 'is', 'order', 'limit', 'single']) {
      builder[name] = () => builder;
    }
    return builder;
  }

  const client = {
    from: query,
    schema: () => ({ rpc: async () => ({ data: { userId: USER, email: 'o@example.test' }, error: null }) }),
  } as unknown as GoalsSupabaseClient;
  return { client, writes };
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

const GOAL = item({ id: 'g', level: 'goal', area_id: 'area', title: 'Get fit' });
const READY = item({ id: 's1', level: 'step', parent_id: 'g', kind: 'claude', title: 'Compare three gyms' });

const routine = { id: 'trig_goals', token: 'token' };

function okFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ claude_code_session_id: 'cse_1' }), { status: 200 }),
  );
}

describe('runGoalsDaily', () => {
  it('starts nothing when the goals routine is not set', async () => {
    const { client, writes } = fakeClient({ items: [GOAL, READY] });
    const result = await runGoalsDaily({ client, routine: { id: null, token: null }, now: NOW });
    expect(result).toEqual({ skipped: 'CLAUDE_GOALS_ROUTINE_ID is not set' });
    expect(writes).toEqual([]);
  });

  it('writes a daily run and fires the routine with the ready steps', async () => {
    const { client, writes } = fakeClient({ items: [GOAL, READY] });
    const fetch = okFetch();
    const result = await runGoalsDaily({ client, routine, now: NOW, fetch });

    expect(result).toEqual({ started: true, runId: 'run-1', steps: 1, held: 0 });
    expect(writes[0]).toMatchObject({
      table: 'runs',
      op: 'insert',
      values: { user_id: USER, job: 'daily', item_id: null, status: 'started', routine_id: 'trig_goals' },
    });
    expect(writes[1]).toMatchObject({ table: 'runs', op: 'update', values: { external_id: 'cse_1' } });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/routines/trig_goals/fire');
    const text = (JSON.parse(init.body as string) as { text: string }).text;
    expect(text).toContain('goals.runs id run-1');
    expect(text).toContain('"Compare three gyms" (goals.items id s1)');
  });

  it('spends no run when no Claude step is ready', async () => {
    const worked = { ...READY, result: 'Gym A', status: 'done' };
    const { client, writes } = fakeClient({ items: [GOAL, worked] });
    const fetch = okFetch();
    const result = await runGoalsDaily({ client, routine, now: NOW, fetch });
    expect(result).toEqual({ skipped: 'no Claude steps are ready' });
    expect(writes).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('runs once a morning, however often the cron fires', async () => {
    const { client, writes } = fakeClient({ items: [GOAL, READY], lastDailyRun: '2026-09-24T11:50:00Z' });
    const result = await runGoalsDaily({ client, routine, now: NOW, fetch: okFetch() });
    expect(result).toEqual({ skipped: 'a morning run already started today' });
    expect(writes).toEqual([]);
  });

  it('records a fire that failed and reports the stage as failed', async () => {
    const { client, writes } = fakeClient({ items: [GOAL, READY] });
    const fetch = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(runGoalsDaily({ client, routine, now: NOW, fetch })).rejects.toThrow(
      /did not start \(run run-1\)/,
    );
    expect(writes[1]).toMatchObject({ table: 'runs', op: 'update', values: { status: 'failed' } });
  });
});
