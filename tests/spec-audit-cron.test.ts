/**
 * The weekly spec audit (plan #1524): the tick that fires the routine, the
 * route that calls it, and the pg_cron job that calls the route. Modelled on
 * tests/vision-review-cron.test.ts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSpecAuditTick } from '@/inngest/dev/spec-audit';
import { specAuditDue } from '@/lib/specs/spec-audit-run';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-10-12T14:47:00Z');
const ROUTINE = { id: 'trig_audit', token: 'tok' };

function fakeClient(fixture: { fires?: unknown[]; findings?: unknown[] }) {
  const inserts: { table: string; values: unknown }[] = [];
  function query(table: string) {
    let inserting = false;
    const builder: Record<string, unknown> = {
      insert(values: unknown) {
        inserting = true;
        inserts.push({ table, values });
        return builder;
      },
      then(resolve: (value: unknown) => unknown) {
        if (inserting) return Promise.resolve({ data: null, error: null }).then(resolve);
        const data = table === 'plan_runs' ? (fixture.fires ?? []) : (fixture.findings ?? []);
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    for (const name of ['select', 'eq', 'order', 'limit']) builder[name] = () => builder;
    return builder;
  }
  const client = {
    from: query,
    rpc: async () => ({ data: { userId: USER, email: 'o@example.test' }, error: null }),
  } as unknown as SupabaseClient;
  return { client, inserts };
}

function okFetch() {
  return vi.fn(
    async () => new Response(JSON.stringify({ claude_code_session_id: 'cse_audit' }), { status: 200 }),
  ) as unknown as typeof globalThis.fetch;
}

describe('when the spec audit is due', () => {
  it('is due with nothing on record', () => {
    expect(specAuditDue({ lastFire: null, lastFindingAt: null, now: NOW })).toEqual({ due: true });
  });

  it('is refused within six days of findings written by hand', () => {
    const due = specAuditDue({ lastFire: null, lastFindingAt: '2026-10-07T06:33:00Z', now: NOW });
    expect(due).toMatchObject({ due: false });
  });

  it('is due again six days after the last run', () => {
    const due = specAuditDue({
      lastFire: { status: 'started', at: '2026-10-05T14:47:00Z' },
      lastFindingAt: '2026-10-05T15:30:00Z',
      now: NOW,
    });
    expect(due).toEqual({ due: true });
  });

  it('does not count a fire that failed', () => {
    const due = specAuditDue({
      lastFire: { status: 'failed', at: '2026-10-12T14:00:00Z' },
      lastFindingAt: null,
      now: NOW,
    });
    expect(due).toEqual({ due: true });
  });
});

describe('the spec audit tick', () => {
  it('fires once a week has passed, and records the fire as an audit run', async () => {
    const { client, inserts } = fakeClient({ findings: [{ created_at: '2026-10-03T06:33:00Z' }] });
    const fetch = okFetch();
    const result = await runSpecAuditTick({ client, routine: ROUTINE, now: NOW, fetch });
    expect(result).toEqual({ started: 'cse_audit' });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/routines/trig_audit/fire');
    expect(String(init.body)).toContain(`user_id ${USER}`);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe('plan_runs');
    expect(inserts[0]!.values).toMatchObject({ user_id: USER, job: 'audit', plan_item_id: null });
  });

  it('refuses a call within six days of the last fire, firing and recording nothing', async () => {
    const { client, inserts } = fakeClient({
      fires: [{ status: 'started', created_at: '2026-10-12T14:47:00Z' }],
      findings: [{ created_at: '2026-10-03T06:33:00Z' }],
    });
    const fetch = okFetch();
    const result = await runSpecAuditTick({ client, routine: ROUTINE, now: NOW + 60_000, fetch });
    expect(result).toMatchObject({ skipped: expect.stringContaining('an audit was started') });
    expect(fetch).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it('records a failed fire naming the missing id when a due week has no routine', async () => {
    const { client, inserts } = fakeClient({});
    const fetch = okFetch();
    const result = await runSpecAuditTick({ client, routine: { id: null, token: null }, now: NOW, fetch });
    expect(result).toEqual({
      failed:
        'CLAUDE_SPEC_AUDIT_ROUTINE_ID is not set on the deployment, so the weekly spec audit could not start.',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(inserts[0]!.values).toMatchObject({ job: 'audit', status: 'failed', routine_id: null });
  });

  it('names the token when the id is set and the token is not', async () => {
    const { client } = fakeClient({});
    const result = await runSpecAuditTick({ client, routine: { id: 'trig_audit', token: null }, now: NOW });
    expect(result).toMatchObject({ failed: expect.stringContaining('CLAUDE_SPEC_AUDIT_ROUTINE_TOKEN') });
  });
});

vi.mock('@/inngest/dev/spec-audit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inngest/dev/spec-audit')>();
  return { ...actual, runSpecAuditTick: vi.fn(actual.runSpecAuditTick) };
});

const { GET, POST } = await import('@/app/api/cron/spec-audit/route');
const tick = vi.mocked(runSpecAuditTick);

function request(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/spec-audit', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the spec audit route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    tick.mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await POST(request('not-the-secret'))).status).toBe(401);
    expect(tick).not.toHaveBeenCalled();
  });

  it('runs the tick for the secret the cron job carries', async () => {
    tick.mockResolvedValueOnce({ skipped: 'an audit was started at 2026-10-12' });
    const response = await POST(request('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, skipped: 'an audit was started at 2026-10-12' });
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0178_spec_audit_weekly.sql'),
  'utf8',
);
const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the spec audit schedule', () => {
  it('lets plan_runs record an audit fire, keeping every earlier job', () => {
    expect(statements).toMatch(/plan_runs_job_ck check \([^;]*'audit'/);
    for (const job of ['vision', 'spec_change', 'overhaul']) {
      expect(statements).toMatch(new RegExp(`plan_runs_job_ck check \\([^;]*'${job}'`));
    }
  });

  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'spec-audit-weekly'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it('fires on Mondays at 14:47 UTC', () => {
    expect(statements).toContain("'47 14 * * 1'");
  });

  it('posts to the route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/spec-audit'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
  });
});
