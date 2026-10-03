/**
 * The weekly connections' clock (plan #1115): the route that writes them and
 * the pg_cron job that calls it.
 *
 * The route can spend model budget and is reachable by anything that knows its
 * URL, so the shared secret is checked on both verbs. The schedule lives in a
 * migration that is applied once and not read again, so what the run depends
 * on is asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/inngest/vault/note-connections', () => ({
  runNoteConnections: vi.fn(async () => ({ people: 1, results: [], failed: [] })),
}));

const { GET, POST } = await import('@/app/api/cron/note-connections/route');
const { runNoteConnections } = await import('@/inngest/vault/note-connections');

function request(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/note-connections', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the note connections route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(runNoteConnections).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await POST(request('not-the-secret'))).status).toBe(401);
    expect(runNoteConnections).not.toHaveBeenCalled();
  });

  it('runs the week for the secret the cron job carries', async () => {
    const response = await POST(request('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, people: 1, results: [], failed: [] });
    expect(runNoteConnections).toHaveBeenCalled();
  });

  it('answers 207 when anyone’s week failed, so the stored reply says so', async () => {
    vi.mocked(runNoteConnections).mockResolvedValueOnce({
      people: 1,
      results: [],
      failed: ['u1: Your credit balance is too low'],
    });
    const response = await POST(request('secret-token'));
    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ ok: false, failed: ['u1: Your credit balance is too low'] });
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0107_note_connections_cron.sql'),
  'utf8',
);

const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the note connections schedule', () => {
  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'note-connections-weekly'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it('fires once a week, after the daily vault sync at 12:33 UTC', () => {
    const cron = statements.match(/'(\d+) (\d+) \* \* (\d)'/);
    expect(cron).not.toBeNull();
    const [, minute, hour] = cron!.map(Number);
    expect(hour! * 60 + minute!).toBeGreaterThan(12 * 60 + 33);
  });

  it('posts to the route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/note-connections'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
    expect(migration).not.toMatch(/https:\/\/[a-z0-9-]+\.vercel\.app/);
  });
});
