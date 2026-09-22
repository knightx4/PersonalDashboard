/**
 * The map sweep's clock (plan #757): the route that works a sweep, and the
 * pg_cron job that calls it.
 *
 * The route spends the account's model budget and is reachable by anything
 * that knows its URL, so the shared secret is checked on both verbs. The
 * schedule lives in a migration that is applied once and not read again, so
 * the properties the sweep depends on are asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/inngest/vault/map-sweep', () => ({
  runMapSweepTick: vi.fn(async () => ({ sweeps: 0, reached: 0, finished: 0, failed: [] })),
}));

const { GET, POST } = await import('@/app/api/cron/map-sweep/route');
const { runMapSweepTick } = await import('@/inngest/vault/map-sweep');

function tickRequest(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/map-sweep', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the map sweep route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(runMapSweepTick).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(tickRequest(null))).status).toBe(401);
    expect((await POST(tickRequest('not-the-secret'))).status).toBe(401);
    expect(runMapSweepTick).not.toHaveBeenCalled();
  });

  it('works the sweeps for the secret the cron job carries', async () => {
    const response = await POST(tickRequest('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, sweeps: 0, reached: 0, finished: 0, failed: [] });
    expect(runMapSweepTick).toHaveBeenCalled();
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0094_map_sweep_tick_cron.sql'),
  'utf8',
);

const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the map sweep schedule', () => {
  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'map-sweep-tick'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it('ticks no more often than a call can last', () => {
    const cron = statements.match(/'\*\/(\d+) \* \* \* \*'/);
    expect(cron).not.toBeNull();
    // A call runs up to five minutes (the route's maxDuration). The lease
    // stops overlap, but a tighter schedule would only produce refused calls.
    expect(Number(cron![1])).toBeGreaterThanOrEqual(5);
  });

  it('posts to the sweep route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/map-sweep'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
    expect(migration).not.toMatch(/https:\/\/[a-z0-9-]+\.vercel\.app/);
  });
});
