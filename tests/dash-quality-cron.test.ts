/**
 * The clock behind the nightly Dash quality check: the route that runs it and
 * the pg_cron job and on-demand function that call it (migration 0277).
 *
 * The route spends model budget and is reachable by anything that knows its
 * URL, so the shared secret is checked on both verbs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/inngest/core/dash-quality', () => ({
  runDashQualityCheck: vi.fn(async () => ({ runId: 'r-1', cases: 3, passed: 3, alerts: 0, noteId: null })),
}));

const { GET, POST } = await import('@/app/api/cron/dash-quality/route');
const { runDashQualityCheck } = await import('@/inngest/core/dash-quality');
const { NextRequest } = await import('next/server');

function request(token: string | null, query = '') {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new NextRequest(`https://example.test/api/cron/dash-quality${query}`, { method: 'POST', headers });
}

describe('the Dash quality route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(runDashQualityCheck).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await POST(request('not-the-secret'))).status).toBe(401);
    expect(runDashQualityCheck).not.toHaveBeenCalled();
  });

  it('runs a nightly check for the secret the cron job carries, and a manual one when asked', async () => {
    const response = await POST(request('secret-token', '?trigger=nightly'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, runId: 'r-1', passed: 3 });
    expect(runDashQualityCheck).toHaveBeenLastCalledWith('nightly');
    await GET(request('secret-token', '?trigger=manual'));
    expect(runDashQualityCheck).toHaveBeenLastCalledWith('manual');
  });
});

const statements = readFileSync(join(import.meta.dirname, '..', 'supabase/migrations/0277_dash_quality.sql'), 'utf8')
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the Dash quality schedule', () => {
  it('unschedules the job by name before scheduling it, and calls the route', () => {
    const unschedule = statements.indexOf("jobname = 'dash-quality-nightly'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
    expect(statements).toContain("'/api/cron/dash-quality?trigger=nightly'");
    expect(statements).toContain("'/api/cron/dash-quality?trigger=manual'");
  });

  it('lets only the service role start a run by hand', () => {
    expect(statements).toMatch(/revoke all on function core\.run_dash_quality\(\) from public, anon, authenticated/);
    expect(statements).toMatch(/grant execute on function core\.run_dash_quality\(\) to service_role/);
  });

  it('keeps to the schema: no rows are changed', () => {
    expect(statements).not.toMatch(/\b(insert into|update core|delete from)\b/i);
  });
});
