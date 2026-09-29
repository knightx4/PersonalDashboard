/**
 * The morning goals run, as the daily cron calls it (plan #933): it fires the
 * goals routine once, with the run row written first, and only when there is
 * an open goal to give a status (plan #1074) or work to do, and no morning
 * run already today.
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
  answers?: Record<string, unknown>[];
  comments?: Record<string, unknown>[];
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
      if (table === 'answers') return { data: fixture.answers ?? [], error: null };
      if (table === 'reviews' || table === 'readings') return { data: [], error: null };
      if (table === 'comments') return { data: fixture.comments ?? [], error: null };
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
    for (const name of ['select', 'eq', 'is', 'not', 'gte', 'order', 'limit', 'single']) {
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

    expect(result).toEqual({ started: true, runId: 'run-1', reviewed: 1, steps: 1, held: 0, answers: 0, stale: 0, evidence: null });
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

  it('gives every open goal its status each morning, with or without a ready step (plan #1074)', async () => {
    const worked = { ...READY, result: 'Gym A', status: 'done' };
    const { client } = fakeClient({ items: [GOAL, worked] });
    const fetch = okFetch();
    const result = await runGoalsDaily({ client, routine, now: NOW, fetch });
    expect(result).toEqual({ started: true, runId: 'run-1', reviewed: 1, steps: 0, held: 0, answers: 0, stale: 0, evidence: null });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const text = (JSON.parse(init.body as string) as { text: string }).text;
    expect(text).toContain('goals.reviews');
    expect(text).toContain('Goal "Get fit" (goals.items id g)');
    expect(text).toContain('No Claude step is ready today.');
  });

  it('hands the session only the evidence Jev kept, reading from the last run (plan #1176)', async () => {
    const { client } = fakeClient({ items: [GOAL, READY], lastDailyRun: '2026-09-23T08:00:00Z' });
    const fetch = okFetch();
    const evidence = vi.fn(async () => ({ lines: ['Jev read the 3 new items since the last run.'], steps: 1 }));
    const result = await runGoalsDaily({ client, routine, now: NOW, fetch, evidence });
    expect(result).toMatchObject({ started: true, evidence: 1 });
    expect(evidence).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, lastRunAt: '2026-09-23T08:00:00Z' }),
    );
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const text = (JSON.parse(init.body as string) as { text: string }).text;
    expect(text).toContain('Jev read the 3 new items since the last run.');
    expect(text).not.toContain('(in Jobs, Gmail, their calendar or Todo)');
  });

  it('spends no run when no goal is open and nothing is ready', async () => {
    const done = { ...GOAL, status: 'done' };
    const { client, writes } = fakeClient({ items: [done] });
    const fetch = okFetch();
    const result = await runGoalsDaily({ client, routine, now: NOW, fetch });
    expect(result).toEqual({
      skipped: 'no open goal, no Claude step ready and no answer out of date',
    });
    expect(writes).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('runs for an answer out of date when no Claude step is ready (plan #989)', async () => {
    const loans = item({ id: 's2', level: 'step', parent_id: 'g', kind: 'mine', title: 'List the loans', status: 'done' });
    const worked = { ...READY, result: 'Gym A', status: 'done' };
    const { client } = fakeClient({
      items: [GOAL, worked, loans],
      answers: [
        {
          id: 'a1',
          item_id: 's2',
          key: 'monthly_total',
          question: 'What is the monthly total?',
          answer: 'About $2,450 a month.',
          sources: [],
          position: 10,
          worked_at: '2026-09-20T00:00:00Z',
          out_of_date_at: '2026-09-23T00:00:00Z',
        },
      ],
    });
    const fetch = okFetch();
    const result = await runGoalsDaily({ client, routine, now: NOW, fetch });
    expect(result).toEqual({ started: true, runId: 'run-1', reviewed: 1, steps: 0, held: 0, answers: 1, stale: 0, evidence: null });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const text = (JSON.parse(init.body as string) as { text: string }).text;
    expect(text).toContain('"List the loans" (goals.items id s2)');
    expect(text).toContain('"What is the monthly total?"');
  });

  it('lists a step of yours untouched for a week for a move (plan #1083)', async () => {
    const old = '2026-09-10T09:00:00Z';
    const sat = item({
      id: 's3', level: 'step', parent_id: 'g', kind: 'mine', title: 'Book a trial class',
      created_at: old, updated_at: old,
    });
    const fresh = item({
      id: 's4', level: 'step', parent_id: 'g', kind: 'mine', title: 'Pick a gym',
      created_at: old, updated_at: old,
    });
    const worked = { ...READY, result: 'Gym A', status: 'done', created_at: old, updated_at: old };
    const { client } = fakeClient({
      items: [GOAL, worked, sat, fresh],
      comments: [{ item_id: 's4', created_at: '2026-09-22T09:00:00Z' }],
    });
    const fetch = okFetch();
    const result = await runGoalsDaily({ client, routine, now: NOW, fetch });
    expect(result).toMatchObject({ started: true, steps: 0, stale: 1 });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    const text = (JSON.parse(init.body as string) as { text: string }).text;
    expect(text).toContain('"Book a trial class" (goals.items id s3), under the goal "Get fit": untouched 14 days');
    expect(text).toContain('Moving a step');
    expect(text).not.toContain('Pick a gym');
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
