/**
 * The clock behind the daily upkeep of the recommended roles: the route and
 * the pg_cron job that calls it.
 *
 * The route spends model budget on scoring, so the shared secret is checked on
 * both verbs. The schedule lives in a migration that is applied once and not
 * read again, so what the run depends on is asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/inngest/jobs/suggestions', () => ({
  runOpeningUpkeep: vi.fn(async () => ({ people: 1, read: 4, closed: 1, scored: 3, failed: [] })),
}));

const { GET, POST } = await import('@/app/api/cron/job-openings/route');
const { runOpeningUpkeep } = await import('@/inngest/jobs/suggestions');

function tickRequest(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/job-openings', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the job openings route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(runOpeningUpkeep).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(tickRequest(null))).status).toBe(401);
    expect((await POST(tickRequest('not-the-secret'))).status).toBe(401);
    expect(runOpeningUpkeep).not.toHaveBeenCalled();
  });

  it('runs the upkeep for the secret the cron job carries', async () => {
    const response = await POST(tickRequest('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, people: 1, read: 4, closed: 1, scored: 3, failed: [] });
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0132_job_openings_cron.sql'),
  'utf8',
);
const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the job openings schedule', () => {
  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'job-openings-daily'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it('runs once a day', () => {
    expect(statements).toContain("'17 15 * * *'");
  });

  it('posts to the route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/job-openings'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
  });
});
