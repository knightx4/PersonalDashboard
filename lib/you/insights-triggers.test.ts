import { describe, expect, it, vi } from 'vitest';
import { runInsightsTick } from '@/inngest/you/insights-tick';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { INSIGHT_RUN_STALE_AFTER_MS } from '@/lib/you/insights-run';
import { startInsightRun } from '@/lib/you/insights-start';
import { decideInsightRun, type ChangeEvent, type TickRun } from '@/lib/you/insights-triggers';

const NOW = Date.parse('2026-10-18T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const run = (status: TickRun['status'], h: number): TickRun => ({
  status,
  requestedAt: hoursAgo(h),
  finishedAt: status === 'ready' || status === 'failed' ? hoursAgo(h - 0.5) : null,
});
const decide = (latest: TickRun | null, lastReady: TickRun | null, events: ChangeEvent[] = []) =>
  decideInsightRun({ now: NOW, latest, lastReady, events, staleAfterMs: INSIGHT_RUN_STALE_AFTER_MS });
const rejection = (h: number): ChangeEvent => ({ at: hoursAgo(h), label: 'a rejection on an application' });

describe('decideInsightRun', () => {
  it('starts the first run as a weekly one', () => {
    expect(decide(null, null)).toEqual({ start: true, reason: 'weekly', change: null });
  });

  it('starts a weekly run when the last ready run is over seven days old', () => {
    const old = run('ready', 8 * 24);
    expect(decide(old, old)).toMatchObject({ start: true, reason: 'weekly' });
  });

  it('waits while the last ready run is under seven days old', () => {
    const recent = run('ready', 6 * 24);
    expect(decide(recent, recent)).toMatchObject({ start: false });
  });

  it('measures the week from when the ready run finished', () => {
    const r: TickRun = { status: 'ready', requestedAt: hoursAgo(7 * 24 + 1), finishedAt: hoursAgo(7 * 24 - 1) };
    expect(decide(r, r)).toMatchObject({ start: false });
  });

  it('starts a change run for a rejection since the last run, naming it', () => {
    const last = run('ready', 3 * 24);
    expect(decide(last, last, [rejection(5)])).toEqual({
      start: true,
      reason: 'change',
      change: 'a rejection on an application',
    });
  });

  it('counts the other events in the line', () => {
    const last = run('ready', 3 * 24);
    const d = decide(last, last, [rejection(5), { at: hoursAgo(9), label: 'an offer on an application' }]);
    expect(d).toMatchObject({ start: true, reason: 'change', change: 'a rejection on an application (and 1 more)' });
  });

  it('ignores an event the last run already saw', () => {
    const last = run('ready', 2 * 24);
    expect(decide(last, last, [rejection(3 * 24)])).toMatchObject({ start: false });
  });

  it('queues a change run at most once a day', () => {
    const last = run('ready', 5);
    expect(decide(last, last, [rejection(1)])).toMatchObject({ start: false });
  });

  it('does not retry a run that failed in the last day', () => {
    expect(decide(run('failed', 5), null)).toMatchObject({ start: false });
  });

  it('starts again the day after a failed run', () => {
    expect(decide(run('failed', 26), null)).toMatchObject({ start: true, reason: 'weekly' });
  });

  it('skips when a run is queued or running', () => {
    const queued = run('queued', 1);
    expect(decide(queued, null, [rejection(0.5)])).toMatchObject({ start: false });
    expect(decide(run('running', 2), null)).toMatchObject({ start: false });
  });

  it('lets a stale run be replaced', () => {
    const stale = run('running', 5);
    expect(decide(stale, null)).toMatchObject({ start: false });
    expect(decide(run('running', 30), null)).toMatchObject({ start: true, reason: 'weekly' });
  });
});

/** A supabase-js double for you.insight_runs: records writes, answers selects from `rows`. */
function fakeYou(opts: { rows?: Array<Record<string, unknown>>; insertError?: { code: string; message: string } } = {}) {
  const calls: Array<{ op: string; table: string; values?: unknown; filters: Array<[string, unknown]> }> = [];
  const rows = opts.rows ?? [];
  const client = {
    from(table: string) {
      const call: (typeof calls)[number] = { op: 'select', table, filters: [] };
      calls.push(call);
      const builder: Record<string, unknown> = {};
      const chain = () => builder;
      for (const m of ['eq', 'in', 'lt', 'order', 'limit']) {
        builder[m] = (...args: unknown[]) => {
          call.filters.push([m, args]);
          return chain();
        };
      }
      builder.select = () => builder;
      builder.update = (v: unknown) => {
        call.op = 'update';
        call.values = v;
        return builder;
      };
      builder.insert = (v: unknown) => {
        call.op = 'insert';
        call.values = v;
        return builder;
      };
      builder.single = async () =>
        opts.insertError ? { data: null, error: opts.insertError } : { data: { id: 'run-new' }, error: null };
      builder.then = (resolve: (v: unknown) => void) => {
        const status = call.filters.find(([m, a]) => m === 'eq' && (a as unknown[])[0] === 'status');
        const data = call.op === 'select' ? (status ? rows.filter((r) => r.status === 'ready') : rows).slice(0, 1) : null;
        resolve({ data, error: null });
      };
      return builder;
    },
  };
  return { client: client as unknown as YouSupabaseClient, calls };
}

const routine = { id: 'rt', token: 'tk' };
const okFetch = () =>
  vi.fn(async () => new Response(JSON.stringify({ claude_code_session_url: 'https://claude.ai/code/s1' }), { status: 200 }));

describe('startInsightRun', () => {
  it('queues the row, fires the brief with the reason and saves the run url', async () => {
    const { client, calls } = fakeYou();
    const fetch = okFetch();
    const r = await startInsightRun({ client, userId: 'u1', reason: 'change', change: 'an offer', routine, now: NOW, fetch });
    expect(r).toEqual({ started: true, runId: 'run-new' });
    expect(calls.some((c) => c.op === 'insert')).toBe(true);
    const sent = JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body).text as string;
    expect(sent).toContain('Insight run run-new');
    expect(sent).toContain('started by a change: an offer');
    expect(calls.some((c) => c.op === 'update' && (c.values as { run_url?: string }).run_url)).toBe(true);
  });

  it('marks a stale run failed before it inserts', async () => {
    const { client, calls } = fakeYou();
    await startInsightRun({ client, userId: 'u1', reason: 'weekly', routine, now: NOW, fetch: okFetch() });
    expect(calls[0].op).toBe('update');
    expect((calls[0].values as { status: string }).status).toBe('failed');
  });

  it('does not fire when a run is already going', async () => {
    const { client } = fakeYou({ insertError: { code: '23505', message: 'duplicate' } });
    const fetch = okFetch();
    const r = await startInsightRun({ client, userId: 'u1', reason: 'weekly', routine, now: NOW, fetch });
    expect(r).toMatchObject({ started: false, reason: 'running' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks the row failed when the fire fails', async () => {
    const { client, calls } = fakeYou();
    const fetch = vi.fn(async () => new Response('nope', { status: 500 }));
    const r = await startInsightRun({ client, userId: 'u1', reason: 'weekly', routine, now: NOW, fetch });
    expect(r).toMatchObject({ started: false, reason: 'error' });
    const failed = calls.filter((c) => c.op === 'update' && String((c.values as { error?: string }).error).startsWith('Dash could not start'));
    expect(failed).toHaveLength(1);
  });

  it('starts nothing without the routine', async () => {
    const { client, calls } = fakeYou();
    const r = await startInsightRun({ client, userId: 'u1', reason: 'weekly', routine: { id: null, token: null }, now: NOW });
    expect(r).toMatchObject({ started: false, reason: 'no_routine' });
    expect(calls).toHaveLength(0);
  });
});

describe('runInsightsTick', () => {
  it('starts a weekly run for an owner with no runs', async () => {
    const { client } = fakeYou();
    const r = await runInsightsTick({ you: client, userId: 'u1', routine, now: NOW, events: async () => [], fetch: okFetch() });
    expect(r).toEqual({ started: true, runId: 'run-new', reason: 'weekly' });
  });

  it('starts a change run on a rejection after a recent ready run', async () => {
    const { client } = fakeYou({ rows: [{ status: 'ready', requested_at: hoursAgo(72), finished_at: hoursAgo(71) }] });
    const r = await runInsightsTick({ you: client, userId: 'u1', routine, now: NOW, events: async () => [rejection(2)], fetch: okFetch() });
    expect(r).toEqual({ started: true, runId: 'run-new', reason: 'change' });
  });

  it('skips while a run is going and fires nothing', async () => {
    const { client } = fakeYou({ rows: [{ status: 'running', requested_at: hoursAgo(1), finished_at: null }] });
    const fetch = okFetch();
    const r = await runInsightsTick({ you: client, userId: 'u1', routine, now: NOW, events: async () => [rejection(0.5)], fetch });
    expect(r).toMatchObject({ skipped: expect.any(String) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('skips when the routine is not set', async () => {
    const r = await runInsightsTick({ routine: { id: null, token: null } });
    expect(r).toMatchObject({ skipped: 'the goals routine is not set' });
  });
});
