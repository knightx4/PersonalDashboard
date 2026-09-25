/**
 * The clock that fires the overnight runner, and the lock on the door it knocks
 * at.
 *
 * The tick is no longer called by Vercel Cron -- the free plan allows one run a
 * day -- but by a `pg_cron` job in Supabase that posts through `pg_net` every
 * few minutes (supabase/migrations/0078_overnight_tick_cron.sql). Two things
 * about that arrangement can break quietly and neither needs a database to
 * check.
 *
 * The first is the door: the route is now reachable by anything on the internet
 * that knows the URL, and the only thing between it and somebody firing Claude
 * sessions on this account is the shared secret. Both verbs are exported, so
 * both are checked.
 *
 * The second is the schedule itself. The tick is safe against overlapping
 * itself only by liveness, not by a lock, so a minute-spaced job could fire one
 * feature twice against one budget; and the origin and the secret are
 * deployment facts that must be read from Vault rather than baked into a file
 * in the repository. A migration is applied once and never looked at again, so
 * those properties are asserted here rather than trusted.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, vi } from 'vitest';

vi.mock('@/inngest/dev/overnight', () => ({
  runOvernightTick: vi.fn(async () => ({ accounts: 0, fired: 0, results: {} })),
}));

vi.mock('@/inngest/goals/quiet-runs', () => ({
  runGoalsQuietSweep: vi.fn(async () => ({ closed: [] })),
}));

const { GET, POST } = await import('@/app/api/cron/overnight/route');
const { runOvernightTick } = await import('@/inngest/dev/overnight');
const { runGoalsQuietSweep } = await import('@/inngest/goals/quiet-runs');

function tickRequest(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/overnight', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the overnight tick route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(runOvernightTick).mockClear();
    vi.mocked(runGoalsQuietSweep).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(tickRequest(null))).status).toBe(401);
    expect((await POST(tickRequest(null))).status).toBe(401);
    expect(runOvernightTick).not.toHaveBeenCalled();
    expect(runGoalsQuietSweep).not.toHaveBeenCalled();
  });

  it('refuses a wrong secret', async () => {
    const response = await POST(tickRequest('not-the-secret'));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
    expect(runOvernightTick).not.toHaveBeenCalled();
  });

  it('ticks for the secret the cron job carries', async () => {
    const response = await POST(tickRequest('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      accounts: 0,
      fired: 0,
      results: {},
      goalsQuiet: { closed: [] },
    });
    expect(runOvernightTick).toHaveBeenCalled();
  });

  it('closes quiet goal runs on every tick, and still ticks when that fails (plan #1002)', async () => {
    vi.mocked(runGoalsQuietSweep).mockRejectedValueOnce(new Error('goals read failed'));
    const response = await POST(tickRequest('secret-token'));
    expect(response.status).toBe(200);
    expect((await response.json()).goalsQuiet).toEqual({ error: 'goals read failed' });
    expect(runGoalsQuietSweep).toHaveBeenCalled();
    expect(runOvernightTick).toHaveBeenCalled();
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0078_overnight_tick_cron.sql'),
  'utf8',
);

/** The migration with its explanatory comment lines taken out. */
const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the pg_cron schedule', () => {
  it('enables both extensions in a way that survives a second run', () => {
    expect(statements).toContain('create extension if not exists pg_cron');
    expect(statements).toContain('create extension if not exists pg_net');
  });

  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf('cron.unschedule');
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(schedule).toBeGreaterThan(-1);
    // Applying twice must leave one job, not two firing against one budget.
    expect(unschedule).toBeLessThan(schedule);
  });

  it('ticks every three to five minutes, not every minute', () => {
    const cron = statements.match(/'\*\/(\d+) \* \* \* \*'/);
    expect(cron).not.toBeNull();
    const minutes = Number(cron![1]);
    // Under three and two ticks can overlap, since the tick is only safe by
    // liveness; over five and a finished session sits idle for too long.
    expect(minutes).toBeGreaterThanOrEqual(3);
    expect(minutes).toBeLessThanOrEqual(5);
  });

  it('posts to the tick route, reading both deployment facts from Vault', () => {
    expect(statements).toContain('net.http_post');
    expect(statements).toContain("'/api/cron/overnight'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
    expect(statements).toContain("'Bearer '");

    // Nothing that looks like a deployed host or a secret is written down here:
    // the repository is the wrong place for either.
    expect(migration).not.toMatch(/https:\/\/(?!your-app\.vercel\.app)[a-z0-9-]+\.vercel\.app/);
  });

  it('says what a person has to put in Vault, by exact name', () => {
    const setup = readFileSync(
      join(import.meta.dirname, '..', 'docs/SETUP.md'),
      'utf8',
    );
    for (const name of ['app_origin', 'cron_secret']) {
      expect(migration).toContain(name);
      // The person setting this up reads SETUP.md, not the migration.
      expect(setup).toContain(name);
    }
  });
});
