/**
 * The weekly review's clock (plan #1232): the route that writes it and the
 * pg_cron job that calls it.
 *
 * The route can spend model budget and is reachable by anything that knows its
 * URL, so the shared secret is checked on both verbs. The schedule lives in a
 * migration that is applied once and not read again, so what the run depends
 * on is asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/inngest/core/week-review', () => ({
  runWeekReviews: vi.fn(async () => ({ people: 1, results: [], failed: [] })),
}));

const { GET, POST } = await import('@/app/api/cron/week-review/route');
const { runWeekReviews } = await import('@/inngest/core/week-review');

function request(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/week-review', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the week review route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(runWeekReviews).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await POST(request('not-the-secret'))).status).toBe(401);
    expect(runWeekReviews).not.toHaveBeenCalled();
  });

  it('runs the reviews for the secret the cron job carries', async () => {
    const response = await POST(request('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, people: 1, results: [], failed: [] });
    expect(runWeekReviews).toHaveBeenCalled();
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0127_week_review_cron.sql'),
  'utf8',
);

const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the week review schedule', () => {
  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'week-review-sunday'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it('fires every hour on Sundays, since 9am in New York is 13:00 or 14:00 UTC by the season', () => {
    expect(statements).toMatch(/'\d+ \* \* \* 0'/);
  });

  it('posts to the route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/week-review'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
    expect(migration).not.toMatch(/https:\/\/[a-z0-9-]+\.vercel\.app/);
  });
});
