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

  it('runs the trigger the job names, and one case only by hand', async () => {
    const response = await POST(request('secret-token', '?trigger=health'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, runId: 'r-1', passed: 3 });
    expect(runDashQualityCheck).toHaveBeenLastCalledWith('health', null);
    await GET(request('secret-token', '?trigger=monthly&case=1d7c8aaf-3ef1-499e-bae0-24899ddfe6e2'));
    expect(runDashQualityCheck).toHaveBeenLastCalledWith('monthly', null);
    await GET(request('secret-token', '?trigger=manual&case=1d7c8aaf-3ef1-499e-bae0-24899ddfe6e2'));
    expect(runDashQualityCheck).toHaveBeenLastCalledWith('manual', '1d7c8aaf-3ef1-499e-bae0-24899ddfe6e2');
    await GET(request('secret-token', '?trigger=manual&case=not-an-id'));
    expect(runDashQualityCheck).toHaveBeenLastCalledWith('manual', null);
  });

  it('runs the free health read for a trigger it does not know, so a stray call spends nothing', async () => {
    await POST(request('secret-token', '?trigger=nightly'));
    expect(runDashQualityCheck).toHaveBeenLastCalledWith('health', null);
    await POST(request('secret-token'));
    expect(runDashQualityCheck).toHaveBeenLastCalledWith('health', null);
  });
});

function statementsOf(file: string): string {
  return readFileSync(join(import.meta.dirname, '..', 'supabase/migrations', file), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}
const statements = statementsOf('0277_dash_quality.sql');
const monthly = statementsOf('0279_dash_quality_monthly.sql');

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
    expect(monthly).not.toMatch(/\b(insert into|update core|delete from)\b/i);
  });
});

describe('the schedule since 0279', () => {
  it('drops the nightly run and asks the cases only on the 1st of the month', () => {
    const unschedule = monthly.indexOf("'dash-quality-nightly', 'dash-quality-health-daily', 'dash-quality-monthly'");
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(monthly.indexOf('cron.schedule('));
    expect(monthly).toMatch(/'dash-quality-monthly',\s*'17 7 1 \* \*'/);
    expect(monthly).toContain("'/api/cron/dash-quality?trigger=monthly'");
  });

  it('reads the real answers every other day, through the trigger that asks nothing', () => {
    expect(monthly).toMatch(/'dash-quality-health-daily',\s*'17 7 2-31 \* \*'/);
    expect(monthly).toContain("'/api/cron/dash-quality?trigger=health'");
    expect(monthly).not.toMatch(/cron\.schedule\(\s*'dash-quality-nightly'/);
  });

  it('lets only the service role start a run by hand, for one case or all', () => {
    expect(monthly).toMatch(/revoke all on function core\.run_dash_quality\(uuid\) from public, anon, authenticated/);
    expect(monthly).toMatch(/grant execute on function core\.run_dash_quality\(uuid\) to service_role/);
    expect(monthly).toContain("'&case=' || p_case::text");
  });
});
