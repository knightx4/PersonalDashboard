/**
 * The weekly goals run, as the daily cron calls it (plan #934): it marks last
 * week's unanswered suggestions ignored every day, and once a week fires the
 * goals routine with the live rhythms and the past reactions in its brief.
 *
 * The client is a stand-in that answers each table's query from a fixture and
 * records every insert and update, as in goals-daily-run.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { runGoalsWeekly } from '@/inngest/goals/weekly';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-10-01T12:00:00Z');

type Fixture = {
  lastWeeklyRun?: string | null;
  items: Record<string, unknown>[];
  past?: Record<string, unknown>[];
};

function fakeClient(fixture: Fixture) {
  const writes: { table: string; op: string; values: unknown; filters: unknown[][] }[] = [];

  function query(table: string) {
    let op = 'select';
    const filters: unknown[][] = [];
    const result = () => {
      if (op === 'insert') return { data: { id: 'run-1' }, error: null };
      if (op === 'update' && table === 'suggestions') return { data: [{ id: 'a' }, { id: 'b' }], error: null };
      if (op === 'update') return { data: null, error: null };
      if (table === 'runs') {
        return {
          data: fixture.lastWeeklyRun ? [{ created_at: fixture.lastWeeklyRun }] : [],
          error: null,
        };
      }
      if (table === 'suggestions') return { data: fixture.past ?? [], error: null };
      if (table === 'areas') return { data: [{ id: 'area', name: 'The city' }], error: null };
      return { data: fixture.items, error: null };
    };
    const builder: Record<string, unknown> = {
      insert(v: unknown) {
        op = 'insert';
        writes.push({ table, op, values: v, filters });
        return builder;
      },
      update(v: unknown) {
        op = 'update';
        writes.push({ table, op, values: v, filters });
        return builder;
      },
      then(resolve: (value: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve);
      },
    };
    for (const name of ['eq', 'is', 'lt', 'gte']) {
      builder[name] = (...args: unknown[]) => {
        filters.push([name, ...args]);
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

const GOAL = item({ id: 'g', level: 'goal', area_id: 'area', title: 'Get plugged into city life' });
const RHYTHM = item({
  id: 'r1',
  level: 'step',
  parent_id: 'g',
  kind: 'rhythm',
  title: 'Go to one city event',
  rhythm_count: 1,
  rhythm_period: 'week',
});
const PAST = {
  id: 'p1',
  item_id: 'r1',
  title: 'Jazz in Bryant Park',
  detail: null,
  url: 'https://example.test/jazz',
  place: 'Bryant Park',
  source: 'NYC Parks',
  happens_on: '2026-09-27',
  starts_at: null,
  reaction: 'going',
  attended: true,
  created_at: '2026-09-24T12:05:00Z',
};

const routine = { id: 'trig_goals', token: 'token' };

function okFetch() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ claude_code_session_id: 'cse_1' }), { status: 200 }),
  );
}

describe('runGoalsWeekly', () => {
  it('starts nothing when the goals routine is not set', async () => {
    const { client, writes } = fakeClient({ items: [GOAL, RHYTHM] });
    const result = await runGoalsWeekly({ client, routine: { id: null, token: null }, now: NOW });
    expect(result).toEqual({ skipped: 'CLAUDE_GOALS_ROUTINE_ID is not set' });
    expect(writes).toEqual([]);
  });

  it('marks last week’s unanswered suggestions ignored, then fires with the past reactions', async () => {
    const { client, writes } = fakeClient({ items: [GOAL, RHYTHM], past: [PAST] });
    const fetch = okFetch();
    const result = await runGoalsWeekly({ client, routine, now: NOW, fetch });

    expect(result).toEqual({ started: true, runId: 'run-1', rhythms: 1, past: 1, ignored: 2 });

    expect(writes[0]).toMatchObject({ table: 'suggestions', op: 'update', values: { reaction: 'ignored' } });
    expect(writes[0].filters).toContainEqual(['eq', 'user_id', USER]);
    expect(writes[0].filters).toContainEqual(['is', 'reaction', null]);
    expect(writes[0].filters).toContainEqual(['lt', 'created_at', '2026-09-24T16:00:00.000Z']);

    expect(writes[1]).toMatchObject({
      table: 'runs',
      op: 'insert',
      values: { user_id: USER, job: 'weekly', item_id: null, status: 'started', routine_id: 'trig_goals' },
    });

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/routines/trig_goals/fire');
    const text = (JSON.parse(init.body as string) as { text: string }).text;
    expect(text).toContain('goals.runs id run-1');
    expect(text).toContain('"Go to one city event" (goals.items id r1)');
    expect(text).toContain('- going, and went: "Jazz in Bryant Park"');
  });

  it('closes the week every day but fires only once a week', async () => {
    const { client, writes } = fakeClient({ items: [GOAL, RHYTHM], lastWeeklyRun: '2026-09-28T12:00:00Z' });
    const fetch = okFetch();
    const result = await runGoalsWeekly({ client, routine, now: NOW, fetch });
    expect(result).toEqual({ skipped: 'a weekly run already started this week', ignored: 2 });
    expect(writes.map((w) => w.table)).toEqual(['suggestions']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('spends no run when there is no live rhythm to research for', async () => {
    const { client, writes } = fakeClient({ items: [GOAL] });
    const fetch = okFetch();
    const result = await runGoalsWeekly({ client, routine, now: NOW, fetch });
    expect(result).toEqual({ skipped: 'no live rhythms to research for', ignored: 2 });
    expect(writes.map((w) => w.table)).toEqual(['suggestions']);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('records a fire that failed and reports the stage as failed', async () => {
    const { client, writes } = fakeClient({ items: [GOAL, RHYTHM] });
    const fetch = vi.fn(async () => new Response('nope', { status: 401 }));
    await expect(runGoalsWeekly({ client, routine, now: NOW, fetch })).rejects.toThrow(
      /weekly goals run did not start \(run run-1\)/,
    );
    expect(writes[2]).toMatchObject({ table: 'runs', op: 'update', values: { status: 'failed' } });
  });
});
