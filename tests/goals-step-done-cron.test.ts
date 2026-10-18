/**
 * The done-step phone message's clock (plan #2376.3): the route that sends it
 * and the pg_cron job that calls it, and the query that picks the steps.
 *
 * The schedule lives in a migration that is applied once and not read again,
 * so what the run depends on is asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/inngest/goals/supabase-admin', () => ({ createGoalsServiceSupabase: vi.fn() }));
vi.mock('@/inngest/core/supabase-admin', () => ({ createCoreServiceSupabase: vi.fn() }));
vi.mock('@/inngest/core/day-brief', () => ({ pushPorts: vi.fn(() => null) }));

const { GET, POST } = await import('@/app/api/cron/goals-step-done/route');
const store = await import('@/inngest/goals/step-done-notify');

function request(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/goals-step-done', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the done-step route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await POST(request('not-the-secret'))).status).toBe(401);
  });
});

/** A query builder that records every filter it is given. */
function recorder(rows: unknown[]) {
  const calls: [string, ...unknown[]][] = [];
  const builder: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'is', 'gte', 'order', 'limit', 'update', 'maybeSingle']) {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
  return { client: { from: () => builder }, calls };
}

describe('the steps a pass picks', () => {
  it('reads only flagged Dash steps closed as done, unannounced, inside the window', async () => {
    const { client, calls } = recorder([]);
    const ports = store.stepDonePorts(client as never, {} as never);
    const since = new Date('2026-10-18T03:00:00Z');
    await ports.due(since);
    expect(calls).toContainEqual(['eq', 'level', 'step']);
    expect(calls).toContainEqual(['eq', 'kind', 'claude']);
    expect(calls).toContainEqual(['eq', 'status', 'done']);
    expect(calls).toContainEqual(['eq', 'notify_on_done', true]);
    expect(calls).toContainEqual(['is', 'notified_at', null]);
    expect(calls).toContainEqual(['gte', 'closed_at', since.toISOString()]);
  });

  it('claims a step only while notified_at is empty, scoped to its person', async () => {
    const { client, calls } = recorder([{ id: 'step-1' }]);
    const ports = store.stepDonePorts(client as never, {} as never);
    const claimed = await ports.claim(
      { id: 'step-1', userId: 'user-1', title: 't', result: null, goalId: null },
      new Date('2026-10-18T09:00:00Z'),
    );
    expect(claimed).toBe(true);
    expect(calls).toContainEqual(['eq', 'user_id', 'user-1']);
    expect(calls).toContainEqual(['is', 'notified_at', null]);
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations-goals/0084_step_done_cron.sql'),
  'utf8',
);

const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the done-step schedule', () => {
  it('unschedules the job by name before scheduling it', () => {
    const unschedule = statements.indexOf("jobname = 'goals-step-done-five-minutes'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
  });

  it('fires every five minutes', () => {
    expect(statements).toContain("'*/5 * * * *'");
  });

  it('posts to the route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/goals-step-done'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
    expect(migration).not.toMatch(/https:\/\/[a-z0-9-]+\.vercel\.app/);
  });
});
