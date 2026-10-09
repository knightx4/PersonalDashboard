/**
 * The evening review's clock (plan #1615): the route that writes it and the
 * pg_cron job that calls it.
 *
 * The route spends model budget and is reachable by anything that knows its
 * URL, so the shared secret is checked on both verbs. The schedule lives in a
 * migration that is applied once and not read again, so what the run depends
 * on is asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/inngest/news/review', () => ({
  runDailyReviews: vi.fn(async () => ({ people: 1, results: [], failed: [] })),
}));

const { GET, POST } = await import('@/app/api/cron/news-review/route');
const { runDailyReviews } = await import('@/inngest/news/review');

function request(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/news-review', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the evening review route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(runDailyReviews).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await POST(request('not-the-secret'))).status).toBe(401);
    expect(runDailyReviews).not.toHaveBeenCalled();
  });

  it('runs the reviews for the secret the cron job carries', async () => {
    const response = await POST(request('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, people: 1, results: [], failed: [] });
    expect(runDailyReviews).toHaveBeenCalled();
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0176_news_review_cron.sql'),
  'utf8',
);

const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the evening review schedule', () => {
  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'news-review-hourly'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it('runs once an hour, so every zone’s 8pm is reached', () => {
    expect(statements).toContain("'1 * * * *'");
  });

  it('posts to the review route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/news-review'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
    expect(migration).not.toMatch(/https:\/\/[a-z0-9-]+\.vercel\.app/);
  });
});
