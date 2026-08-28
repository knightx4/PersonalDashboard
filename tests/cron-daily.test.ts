/**
 * The consolidated cron.
 *
 * Three scheduled jobs had to become one, because the Hobby plan caps them per
 * project. That is a forced change to something that already worked, so the two
 * properties it must not lose are covered here: every account still gets its
 * sync attempted even when one of them throws, and a failing stage does not
 * take the other stages down with it. The second matters most -- the commerce
 * sync has been running for months, and the job workspace's stages are new.
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

vi.mock('@/inngest/cron/shopping-inbox', () => ({
  runShoppingIncrementalSync: vi.fn(async () => ({
    accounts: 1,
    started: 1,
    alreadyRunning: 0,
    skipped: [],
  })),
}));
vi.mock('@/inngest/jobs/cron/inbox', () => ({
  runJobIncrementalSync: vi.fn(async () => {
    throw new Error('job inbox exploded');
  }),
}));
vi.mock('@/inngest/jobs/cron/sweep', () => ({
  runJobSweep: vi.fn(async () => ({ ghosted: 3, reminders: 2 })),
}));

const { GET } = await import('@/app/api/cron/daily/route');
const { runShoppingIncrementalSync } = await import('@/inngest/cron/shopping-inbox');
const { runJobSweep } = await import('@/inngest/jobs/cron/sweep');

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
    expect(body.failed).toEqual(['jobs-inbox']);

    // The stage that broke is the new one; the one that has been running for
    // months still ran, and so did the stage after the failure.
    expect(runShoppingIncrementalSync).toHaveBeenCalled();
    expect(runJobSweep).toHaveBeenCalled();
    expect(body.results['shopping-inbox']).toEqual({
      accounts: 1,
      started: 1,
      alreadyRunning: 0,
      skipped: [],
    });
    expect(body.results['jobs-sweep']).toEqual({ ghosted: 3, reminders: 2 });
    expect(body.results['jobs-inbox']).toEqual({ error: 'job inbox exploded' });
  });
});
