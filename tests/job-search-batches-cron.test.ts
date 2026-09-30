/**
 * The clock that finishes searches carried on as Message Batches: the route
 * and the pg_cron job that calls it.
 *
 * The route spends model budget on storing and scoring searches, so the shared secret is checked on
 * both verbs. The schedule lives in a migration that is applied once and not
 * read again, so what the run depends on is asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/inngest/jobs/suggestions', () => ({
  runSearchBatches: vi.fn(async () => ({ checked: 2, finished: 1, failed: 0, pending: 1 })),
}));

const { GET, POST } = await import('@/app/api/cron/job-search-batches/route');
const { runSearchBatches } = await import('@/inngest/jobs/suggestions');

function tickRequest(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/job-search-batches', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the job search batches route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(runSearchBatches).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(tickRequest(null))).status).toBe(401);
    expect((await POST(tickRequest('not-the-secret'))).status).toBe(401);
    expect(runSearchBatches).not.toHaveBeenCalled();
  });

  it('collects the batches for the secret the cron job carries', async () => {
    const response = await POST(tickRequest('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, checked: 2, finished: 1, failed: 0, pending: 1 });
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0133_job_search_batches_cron.sql'),
  'utf8',
);
const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the job search batches schedule', () => {
  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'job-search-batches'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it('runs every ten minutes', () => {
    expect(statements).toContain("'*/10 * * * *'");
  });

  it('posts to the route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/job-search-batches'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
  });
});
