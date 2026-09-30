/**
 * Maya's hourly clock (plan #1289): the route that runs the gate and the
 * pg_cron job that calls it.
 *
 * The route spends Jev and model budget and is reachable by anything that
 * knows its URL, so the shared secret is checked on both verbs. The schedule
 * lives in a migration that is applied once and not read again, so what the
 * run depends on is asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/inngest/vault/maya-gate', () => ({
  runMayaGate: vi.fn(async () => ({ people: 1, results: [], failed: [] })),
}));

const { GET, POST } = await import('@/app/api/cron/maya-gate/route');
const { runMayaGate } = await import('@/inngest/vault/maya-gate');

function request(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/maya-gate', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the Maya gate route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(runMayaGate).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await POST(request('not-the-secret'))).status).toBe(401);
    expect(runMayaGate).not.toHaveBeenCalled();
  });

  it('runs the gate for the secret the cron job carries', async () => {
    const response = await POST(request('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, people: 1, results: [], failed: [] });
    expect(runMayaGate).toHaveBeenCalled();
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0131_maya_gate_cron.sql'),
  'utf8',
);

const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the Maya gate schedule', () => {
  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'maya-gate-hourly'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it('fires every hour, at a minute after the daily vault sync at :33', () => {
    const cron = statements.match(/'(\d+) \* \* \* \*'/);
    expect(cron).not.toBeNull();
    expect(Number(cron![1])).toBeGreaterThan(33);
  });

  it('posts to the route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/maya-gate'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
    expect(migration).not.toMatch(/https:\/\/[a-z0-9-]+\.vercel\.app/);
  });

  it('waits no longer for the reply than the route may run', () => {
    const timeout = statements.match(/timeout_milliseconds := (\d+)/);
    expect(Number(timeout![1])).toBeLessThan(300_000);
  });
});
