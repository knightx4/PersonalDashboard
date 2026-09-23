/**
 * The newsletter catch-up's clock (plan #787): the route that summarises
 * pending issues, and the pg_cron job that calls it.
 *
 * The route spends model budget and is reachable by anything that knows its
 * URL, so the shared secret is checked on both verbs. The schedule lives in a
 * migration that is applied once and not read again, so what the catch-up
 * depends on is asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/inngest/news/digest', () => ({
  runNewsDigestTick: vi.fn(async () => ({ digested: 2, failed: 0, missing: 0, left: 0 })),
}));

const { GET, POST } = await import('@/app/api/cron/news-digest/route');
const { runNewsDigestTick } = await import('@/inngest/news/digest');

function tickRequest(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/news-digest', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the newsletter catch-up route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(runNewsDigestTick).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(tickRequest(null))).status).toBe(401);
    expect((await POST(tickRequest('not-the-secret'))).status).toBe(401);
    expect(runNewsDigestTick).not.toHaveBeenCalled();
  });

  it('summarises pending issues for the secret the cron job carries', async () => {
    const response = await POST(tickRequest('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      digested: 2,
      failed: 0,
      missing: 0,
      left: 0,
    });
    expect(runNewsDigestTick).toHaveBeenCalled();
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0100_news_digest_tick_cron.sql'),
  'utf8',
);

const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the newsletter catch-up schedule', () => {
  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'news-digest-tick'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it('runs once an hour', () => {
    expect(statements).toContain("'29 * * * *'");
  });

  it('posts to the catch-up route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/news-digest'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
    expect(migration).not.toMatch(/https:\/\/[a-z0-9-]+\.vercel\.app/);
  });
});
