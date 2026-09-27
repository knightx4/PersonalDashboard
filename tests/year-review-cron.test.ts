/**
 * The year in review's clock (plan #1121): the route that writes last year's
 * reviews and the pg_cron job that calls it.
 *
 * The route can spend model budget and is reachable by anything that knows its
 * URL, so the shared secret is checked on both verbs. The schedule lives in a
 * migration that is applied once and not read again, so what the run depends
 * on is asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/inngest/core/year-review', () => ({
  runYearReviews: vi.fn(async () => ({ year: 2026, people: 1, results: [], failed: [] })),
}));

const { GET, POST } = await import('@/app/api/cron/year-review/route');
const { runYearReviews } = await import('@/inngest/core/year-review');

function request(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/year-review', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the year review route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(runYearReviews).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await POST(request('not-the-secret'))).status).toBe(401);
    expect(runYearReviews).not.toHaveBeenCalled();
  });

  it('writes last year for the secret the cron job carries', async () => {
    const response = await POST(request('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, year: 2026, people: 1, results: [], failed: [] });
    expect(runYearReviews).toHaveBeenCalled();
  });
});

const migration = readFileSync(join(import.meta.dirname, '..', 'supabase/migrations/0112_year_reviews.sql'), 'utf8');

const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the year review schedule', () => {
  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'year-review-yearly'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it('fires once a year, on 2 January, when the year has ended in every time zone', () => {
    const cron = statements.match(/'(\d+) (\d+) (\d+) (\d+) \*'/);
    expect(cron).not.toBeNull();
    // UTC-12, the last zone to leave the year, reaches 1 January at 12:00
    // UTC on 1 January, so any time on 2 January is past it.
    const [, , , day, month] = cron!.map(Number);
    expect(month).toBe(1);
    expect(day).toBe(2);
  });

  it('posts to the route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/year-review'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
    expect(migration).not.toMatch(/https:\/\/[a-z0-9-]+\.vercel\.app/);
  });
});
