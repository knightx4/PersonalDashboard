/**
 * The Inspiration tab's daily check (plan #1411): the route that runs it and
 * the pg_cron job that calls it.
 *
 * The route spends transcript credits and model calls, so the shared secret is
 * checked on both verbs. The schedule lives in a migration that is applied
 * once and not read again, so what the run depends on is asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/dev/inspiration/check', () => ({
  checkInspirationForEveryone: vi.fn(async () => []),
}));
vi.mock('@/inngest/core/supabase-admin', () => ({ createCoreServiceSupabase: vi.fn(() => ({})) }));
vi.mock('@/inngest/learn/supabase-admin', () => ({ createLearnServiceSupabase: vi.fn(() => ({})) }));

const { GET, POST } = await import('@/app/api/cron/inspiration/route');
const { checkInspirationForEveryone } = await import('@/lib/dev/inspiration/check');

function request(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/inspiration', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the inspiration route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(checkInspirationForEveryone).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await POST(request('not-the-secret'))).status).toBe(401);
    expect(checkInspirationForEveryone).not.toHaveBeenCalled();
  });

  it('runs the scheduled check for the secret the cron job carries', async () => {
    const response = await POST(request('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, results: [] });
    expect(checkInspirationForEveryone).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ trigger: 'scheduled', deadline: expect.any(Number) }),
    );
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0145_inspiration_check.sql'),
  'utf8',
);

const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the inspiration schedule', () => {
  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'inspiration-daily'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it('fires once a day', () => {
    expect(statements).toMatch(/'\d+ \d+ \* \* \*'/);
  });

  it('posts to the route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/inspiration'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
    expect(migration).not.toMatch(/https:\/\/[a-z0-9-]+\.vercel\.app/);
  });
});
