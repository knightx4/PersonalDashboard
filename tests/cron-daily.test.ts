/**
 * The consolidated cron.
 *
 * Three scheduled jobs became one, because the Hobby plan caps them per
 * project; unifying ingestion then took it to two, since there is one inbox
 * sync serving both workspaces rather than one each, and the JD backfill then
 * took it to three. The two properties that must survive all of that are
 * covered here: every account still gets its sync attempted even when one of
 * them throws, and a failing stage does not take the other stages down with
 * it.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// after() defers work past the response, which needs a request context that a
// unit test has no way to provide. The callbacks are collected instead.
const deferred: Array<() => unknown> = [];
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: (fn: () => unknown) => deferred.push(fn) };
});

const { runIncrementalSync } = await import('@/inngest/cron/incremental');

beforeEach(() => {
  deferred.length = 0;
});

function account(id: string) {
  return { id, user_id: `user-${id}` };
}

describe('runIncrementalSync', () => {
  it('starts a sync for each account and pumps it in the background', async () => {
    const pump = vi.fn(async () => {});
    const summary = await runIncrementalSync({
      origin: 'https://example.test',
      listAccounts: async () => [account('a'), account('b')],
      start: async ({ accountId }) => ({ jobId: `job-${accountId}`, alreadyRunning: false }),
      pump,
    });

    expect(summary).toEqual({ accounts: 2, started: 2, alreadyRunning: 0, skipped: [] });

    // Pumping happens after the response, so nothing has run yet.
    expect(pump).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(2);
    await Promise.all(deferred.map((fn) => fn()));
    expect(pump).toHaveBeenCalledTimes(2);
    expect(pump).toHaveBeenCalledWith({
      userId: 'user-a',
      accountId: 'a',
      jobId: 'job-a',
      origin: 'https://example.test',
      type: 'incremental',
    });
  });

  it('counts an already-running job without starting a second pump', async () => {
    const pump = vi.fn(async () => {});
    const summary = await runIncrementalSync({
      origin: 'o',
      listAccounts: async () => [account('a')],
      start: async () => ({ jobId: 'job-a', alreadyRunning: true }),
      pump,
    });

    expect(summary.alreadyRunning).toBe(1);
    expect(summary.started).toBe(0);
    expect(deferred).toHaveLength(0);
  });

  it('records a skip with its reason', async () => {
    const summary = await runIncrementalSync({
      origin: 'o',
      listAccounts: async () => [account('a')],
      start: async () => ({ skipped: 'no cursor yet' }),
      pump: async () => {},
    });

    expect(summary.skipped).toEqual([{ accountId: 'a', reason: 'no cursor yet' }]);
  });

  it('keeps going when one account throws, so one bad inbox cannot stall the rest', async () => {
    const summary = await runIncrementalSync({
      origin: 'o',
      listAccounts: async () => [account('a'), account('bad'), account('c')],
      start: async ({ accountId }) => {
        if (accountId === 'bad') throw new Error('token expired');
        return { jobId: `job-${accountId}`, alreadyRunning: false };
      },
      pump: async () => {},
    });

    expect(summary.started).toBe(2);
    expect(summary.skipped).toEqual([{ accountId: 'bad', reason: 'token expired' }]);
  });
});

vi.mock('@/inngest/cron/inbox', () => ({
  runInboxIncrementalSync: vi.fn(async () => {
    throw new Error('inbox exploded');
  }),
}));
vi.mock('@/inngest/jobs/cron/sweep', () => ({
  runJobSweep: vi.fn(async () => ({ ghosted: 3, reminders: 2 })),
}));
vi.mock('@/inngest/jobs/cron/jd-backfill', () => ({
  runJdBackfill: vi.fn(async () => ({ companies: 1, filled: 2, ambiguous: 0, closed: 1, noBoard: 0 })),
}));

const { GET } = await import('@/app/api/cron/daily/route');
const { runJobSweep } = await import('@/inngest/jobs/cron/sweep');
const { runJdBackfill } = await import('@/inngest/jobs/cron/jd-backfill');

function cronRequest(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/daily', {
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the daily cron route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
  });

  it('refuses a request without the shared secret', async () => {
    const response = await GET(cronRequest(null));
    expect(response.status).toBe(401);
  });

  it('refuses a wrong secret', async () => {
    const response = await GET(cronRequest('not-the-secret'));
    expect(response.status).toBe(401);
  });

  it('runs the surviving stages when one throws, and says which failed', async () => {
    const response = await GET(cronRequest('secret-token'));

    // 207, not 500: real work happened, and a log reader needs to know which
    // part did not.
    expect(response.status).toBe(207);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.failed).toEqual(['inbox']);

    // Every stage after the failure still ran. That is the property that
    // matters: a broken sync must not also cost the job workspace its nightly
    // sweep, nor the job descriptions the sweep never needed in the first place.
    expect(runJobSweep).toHaveBeenCalled();
    expect(runJdBackfill).toHaveBeenCalled();
    expect(body.results['jobs-sweep']).toEqual({ ghosted: 3, reminders: 2 });
    expect(body.results['jd-backfill']).toEqual({
      companies: 1,
      filled: 2,
      ambiguous: 0,
      closed: 1,
      noBoard: 0,
    });
    expect(body.results['inbox']).toEqual({ error: 'inbox exploded' });
  });
});
