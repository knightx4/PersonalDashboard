import { describe, expect, it, vi } from 'vitest';
import { runDashQuestionsTick } from '@/inngest/you/dash-questions-tick';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { QUESTION_RUN_STALE_AFTER_MS, WEEKLY_BRIEF_LINE } from '@/lib/you/dash-questions-run';
import { decideQuestionRun, nextWeeklyAskAt, type QuestionTickRun } from '@/lib/you/dash-questions-triggers';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 24 * 3600_000).toISOString();
const run = (status: QuestionTickRun['status'], d: number): QuestionTickRun => ({
  status,
  requestedAt: daysAgo(d),
  finishedAt: status === 'ready' || status === 'failed' ? daysAgo(d - 0.01) : null,
});

/** A last ready run eight days ago, two open, an answer since: the state that starts one. */
const base = {
  now: NOW,
  latest: run('ready', 8) as QuestionTickRun | null,
  lastReady: run('ready', 8) as QuestionTickRun | null,
  openCount: 2,
  lastResponseAt: daysAgo(3) as string | null,
  staleAfterMs: QUESTION_RUN_STALE_AFTER_MS,
};
const decide = (over: Partial<typeof base> = {}) => decideQuestionRun({ ...base, ...over });

describe('nextWeeklyAskAt (plan #2635.3)', () => {
  const next = (over: Partial<Parameters<typeof nextWeeklyAskAt>[0]> = {}) =>
    nextWeeklyAskAt({ now: NOW, latest: run('ready', 3), openCount: 0, lastResponseAt: daysAgo(1), ...over });

  it('is the first daily tick a week after the newest run', () => {
    // Asked at noon on 29 October: a week on is noon on 5 November.
    expect(next()).toBe('2026-11-05T12:00:00.000Z');
    // Asked at 13:00 ends the week after that day's tick, so it is the next day's.
    expect(next({ latest: { status: 'failed', requestedAt: '2026-10-30T13:00:00Z', finishedAt: null } })).toBe(
      '2026-11-07T12:00:00.000Z',
    );
  });

  it('is the next tick when the week has passed or there was never a run', () => {
    expect(next({ latest: run('ready', 10) })).toBe('2026-11-01T12:00:00.000Z');
    expect(next({ latest: null, lastResponseAt: null, now: Date.parse('2026-11-01T15:00:00Z') })).toBe(
      '2026-11-02T12:00:00.000Z',
    );
  });

  it('is null while three wait or nothing was answered since the last run', () => {
    expect(next({ openCount: 3 })).toBeNull();
    expect(next({ lastResponseAt: daysAgo(5) })).toBeNull();
    expect(next({ lastResponseAt: null })).toBeNull();
  });
});

describe('decideQuestionRun', () => {
  it('starts with fewer than three open, a week since the last run and an answer since', () => {
    expect(decide()).toEqual({ start: true });
  });

  it('counts a skip the same as an answer', () => {
    expect(decide({ lastResponseAt: daysAgo(1) })).toEqual({ start: true });
  });

  it('starts the first run with no answers at all', () => {
    expect(decide({ latest: null, lastReady: null, openCount: 0, lastResponseAt: null })).toEqual({ start: true });
  });

  it('starts when no run has ever finished ready, a week after a failed one', () => {
    expect(decide({ latest: run('failed', 8), lastReady: null, lastResponseAt: null })).toEqual({ start: true });
  });

  it('skips while a run is queued or running and not stale', () => {
    expect(decide({ latest: run('queued', 0.01) })).toMatchObject({ start: false });
    expect(decide({ latest: run('running', 0.05) })).toMatchObject({ start: false });
  });

  it('still waits the week behind a stale run', () => {
    const stale = run('running', 1);
    expect(Date.parse(stale.requestedAt)).toBeLessThan(NOW - QUESTION_RUN_STALE_AFTER_MS);
    expect(decide({ latest: stale })).toMatchObject({ start: false, skipped: expect.stringContaining('week') });
    expect(decide({ latest: run('running', 8) })).toEqual({ start: true });
  });

  it('skips within seven days of the last run of any status', () => {
    for (const status of ['ready', 'failed'] as const) {
      const r = run(status, 6.9);
      expect(decide({ latest: r, lastReady: status === 'ready' ? r : null })).toMatchObject({ start: false });
    }
  });

  it('skips with three or more open questions', () => {
    expect(decide({ openCount: 3 })).toMatchObject({ start: false, skipped: '3 questions are still open' });
    expect(decide({ openCount: 7 })).toMatchObject({ start: false });
  });

  it('skips when nothing was answered or skipped since the last ready run finished', () => {
    expect(decide({ lastResponseAt: null })).toMatchObject({ start: false });
    expect(decide({ lastResponseAt: daysAgo(9) })).toMatchObject({ start: false });
  });
});

type Rows = {
  latest?: Record<string, unknown>[];
  ready?: Record<string, unknown>[];
  open?: number;
  answered?: string | null;
  skipped?: string | null;
};

/** A supabase-js double for the two tables: answers each read by its table and filters, records writes. */
function fakeYou(rows: Rows) {
  const writes: Array<{ op: string; table: string; values: unknown }> = [];
  const client = {
    from(table: string) {
      const state = { op: 'select', filters: [] as Array<[string, unknown[]]> };
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'lt', 'not', 'order', 'limit']) {
        b[m] = (...args: unknown[]) => {
          state.filters.push([m, args]);
          return b;
        };
      }
      for (const op of ['update', 'insert'] as const) {
        b[op] = (values: unknown) => {
          state.op = op;
          writes.push({ op, table, values });
          return b;
        };
      }
      b.single = async () => ({ data: { id: 'run-new' }, error: null });
      b.then = (resolve: (v: unknown) => void) => {
        if (state.op !== 'select') return resolve({ data: null, error: null });
        const has = (m: string, first: unknown) => state.filters.some(([f, a]) => f === m && a[0] === first);
        if (table === 'dash_question_runs') {
          return resolve({ data: has('eq', 'status') ? (rows.ready ?? []) : (rows.latest ?? []), error: null });
        }
        if (has('eq', 'status')) return resolve({ data: null, count: rows.open ?? 0, error: null });
        if (has('not', 'answered_at')) {
          return resolve({ data: rows.answered ? [{ answered_at: rows.answered }] : [], error: null });
        }
        return resolve({ data: rows.skipped ? [{ skipped_at: rows.skipped }] : [], error: null });
      };
      return b;
    },
  };
  return { client: client as unknown as YouSupabaseClient, writes };
}

const routine = { id: 'rt', token: 'tk' };
const okFetch = () =>
  vi.fn(async () => new Response(JSON.stringify({ claude_code_session_url: 'https://claude.ai/code/s1' }), { status: 200 }));
const readyRow = { status: 'ready', requested_at: daysAgo(8), finished_at: daysAgo(7.99) };

describe('runDashQuestionsTick', () => {
  it('queues one run with the weekly brief after a skip since the last run', async () => {
    const { client, writes } = fakeYou({ latest: [readyRow], ready: [readyRow], open: 1, skipped: daysAgo(2), answered: daysAgo(10) });
    const fetch = okFetch();
    const r = await runDashQuestionsTick({ you: client, userId: 'u1', now: NOW, routine, fetch });
    expect(r).toEqual({ started: true, runId: 'run-new' });
    expect(writes.filter((w) => w.op === 'insert')).toHaveLength(1);
    const sent = JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body).text as string;
    expect(sent).toContain('Question run run-new');
    expect(sent.split('\n').at(-1)).toBe(WEEKLY_BRIEF_LINE);
  });

  it('queues nothing with three open questions', async () => {
    const { client, writes } = fakeYou({ latest: [readyRow], ready: [readyRow], open: 3, answered: daysAgo(1) });
    const fetch = okFetch();
    expect(await runDashQuestionsTick({ you: client, userId: 'u1', now: NOW, routine, fetch })).toMatchObject({ skipped: expect.any(String) });
    expect(writes).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('queues nothing when the only answers came before the last run', async () => {
    const { client, writes } = fakeYou({ latest: [readyRow], ready: [readyRow], open: 0, answered: daysAgo(9), skipped: daysAgo(12) });
    expect(await runDashQuestionsTick({ you: client, userId: 'u1', now: NOW, routine, fetch: okFetch() })).toMatchObject({
      skipped: expect.any(String),
    });
    expect(writes).toHaveLength(0);
  });

  it('skips without the routine and queues nothing', async () => {
    const { client, writes } = fakeYou({});
    const r = await runDashQuestionsTick({ you: client, userId: 'u1', now: NOW, routine: { id: null, token: null } });
    expect(r).toMatchObject({ skipped: expect.stringContaining('routine') });
    expect(writes).toHaveLength(0);
  });
});
