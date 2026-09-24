/**
 * The YouTube library's clock: the route that lists channels and spends
 * TranscriptAPI credits, and the pg_cron job that calls it.
 *
 * The route spends credits and is reachable by anything that knows its URL,
 * so the shared secret is checked on both verbs. The budget in
 * lib/learn/youtube/budget.ts assumes four runs a day, so the schedule is
 * asserted against that constant.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEDULED_RUNS_PER_DAY } from '@/lib/learn/youtube/budget';

vi.mock('@/inngest/learn/youtube-library', () => ({
  runYouTubeLibraryTick: vi.fn(async () => ({ channels: [], transcripts: null, allowance: 25, embedding: null })),
}));

const { GET, POST } = await import('@/app/api/cron/youtube-library/route');
const { runYouTubeLibraryTick } = await import('@/inngest/learn/youtube-library');

function tickRequest(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/youtube-library', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the YouTube library route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(runYouTubeLibraryTick).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(tickRequest(null))).status).toBe(401);
    expect((await POST(tickRequest('not-the-secret'))).status).toBe(401);
    expect(runYouTubeLibraryTick).not.toHaveBeenCalled();
  });

  it('runs for the secret the cron job carries', async () => {
    const response = await POST(tickRequest('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, allowance: 25 });
    expect(runYouTubeLibraryTick).toHaveBeenCalled();
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0101_youtube_library_tick_cron.sql'),
  'utf8',
);

const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the YouTube library schedule', () => {
  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'youtube-library-tick'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it('runs as many times a day as the budget assumes', () => {
    const cron = /'(\d+) ([\d,]+) \* \* \*'/.exec(statements);
    expect(cron).not.toBeNull();
    expect(cron![2].split(',')).toHaveLength(SCHEDULED_RUNS_PER_DAY);
  });

  it('posts to the library route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/youtube-library'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
    expect(migration).not.toMatch(/https:\/\/[a-z0-9-]+\.vercel\.app/);
  });
});
