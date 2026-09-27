/**
 * The weekly vision review (plan #1108): the tick that fires the routine, the
 * route that calls it, and the pg_cron job that calls the route.
 *
 * The route spends the owner's routine allowance and is reachable by anything
 * that knows its URL, so the shared secret is checked on both verbs. The
 * schedule lives in a migration that is applied once and not read again, so
 * what the run depends on is asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runVisionReviewTick } from '@/inngest/dev/vision-review';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-10-04T14:41:00Z');
const ROUTINE = { id: 'trig_vision', token: 'tok' };

function fakeClient(fixture: { fires?: unknown[]; reviews?: unknown[] }) {
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
        const data = table === 'plan_runs' ? (fixture.fires ?? []) : (fixture.reviews ?? []);
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
    async () =>
      new Response(JSON.stringify({ claude_code_session_id: 'cse_vision' }), { status: 200 }),
  ) as unknown as typeof globalThis.fetch;
}

describe('the vision review tick', () => {
  it('starts nothing without a routine', async () => {
    const result = await runVisionReviewTick({ routine: { id: null, token: null }, now: NOW });
    expect(result).toEqual({ skipped: 'CLAUDE_VISION_ROUTINE_ID is not set' });
  });

  it('fires once a week has passed, and records the fire as a vision run', async () => {
    const { client, inserts } = fakeClient({ reviews: [{ created_at: '2026-09-27T16:00:00Z' }] });
    const fetch = okFetch();
    const result = await runVisionReviewTick({ client, routine: ROUTINE, now: NOW, fetch });
    expect(result).toEqual({ started: 'cse_vision' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe('plan_runs');
    expect(inserts[0]!.values).toMatchObject({ user_id: USER, job: 'vision', plan_item_id: null });
  });

  it('does not fire twice in one week', async () => {
    const { client, inserts } = fakeClient({
      fires: [{ status: 'started', created_at: '2026-10-04T14:41:00Z', error: null }],
      reviews: [{ created_at: '2026-09-27T16:00:00Z' }],
    });
    const fetch = okFetch();
    const result = await runVisionReviewTick({ client, routine: ROUTINE, now: NOW + 60_000, fetch });
    expect(result).toHaveProperty('skipped');
    expect(fetch).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });
});

vi.mock('@/inngest/dev/vision-review', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/inngest/dev/vision-review')>();
  return { ...actual, runVisionReviewTick: vi.fn(actual.runVisionReviewTick) };
});

const { GET, POST } = await import('@/app/api/cron/vision-review/route');
const tick = vi.mocked(runVisionReviewTick);

function request(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/vision-review', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the vision review route', () => {
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
    tick.mockResolvedValueOnce({ skipped: 'a review was written at 2026-10-04' });
    const response = await POST(request('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, skipped: 'a review was written at 2026-10-04' });
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0110_vision_review_weekly.sql'),
  'utf8',
);
const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the vision review schedule', () => {
  it('lets plan_runs record a vision fire', () => {
    expect(statements).toMatch(/plan_runs_job_ck check \([^;]*'vision'/);
  });

  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'vision-review-weekly'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it('fires once a week, on Sundays', () => {
    expect(statements).toMatch(/'\d+ \d+ \* \* 0'/);
  });

  it('posts to the route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/vision-review'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
  });
});
