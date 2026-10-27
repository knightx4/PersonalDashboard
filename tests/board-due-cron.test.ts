/**
 * The daily board notification's clock (plan #2581.10): the route that sends
 * it, the pass it runs, and the pg_cron job that calls it.
 *
 * The schedule lives in a migration that is applied once and not read again,
 * so what the run depends on is asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/inngest/core/day-brief', () => ({ pushPorts: vi.fn() }));

const { runBoardDueWith } = await import('@/inngest/you/board-due');

describe('one pass of the board notification', () => {
  const rows = [
    {
      id: 'q1',
      user_id: 'u1',
      question: 'Take the contract?',
      status: 'decided',
      decided_at: '2026-09-01T10:00:00Z',
      reviews: [],
      tripwire: { condition: 'No interviews', check_on: '2026-10-01', status: 'watching' },
      notified: {},
    },
    { id: 'q2', user_id: 'u2', question: 'Move?', status: 'decided', decided_at: '2026-10-20T00:00:00Z', reviews: [], notified: {} },
  ];

  it('sends one notification per person with something due and records what it announced', async () => {
    const notified = vi.fn(async () => {});
    const send = vi.fn(async () => ({ sent: 1, forgotten: 0, failed: 0 }));
    const summary = await runBoardDueWith(
      { rows: async () => rows, push: () => ({}) as never, notified, send },
      new Date('2026-10-01T08:13:00Z'),
    );
    expect(summary.people).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(notified).toHaveBeenCalledWith('u1', 'q1', {
      'review:30': '2026-10-01T08:13:00.000Z',
      'tripwire:2026-10-01': '2026-10-01T08:13:00.000Z',
    });
  });

  it('leaves it unannounced when nothing could be sent', async () => {
    const notified = vi.fn(async () => {});
    await runBoardDueWith(
      {
        rows: async () => rows,
        push: () => ({}) as never,
        notified,
        send: async () => ({ sent: 0, forgotten: 0, failed: 1 }),
      },
      new Date('2026-10-01T08:13:00Z'),
    );
    await runBoardDueWith(
      { rows: async () => rows, push: () => null, notified, send: vi.fn() },
      new Date('2026-10-01T08:13:00Z'),
    );
    expect(notified).not.toHaveBeenCalled();
  });
});

vi.mock('@/inngest/you/board-due', async (original) => ({
  ...(await original<typeof import('@/inngest/you/board-due')>()),
  runBoardDue: vi.fn(async () => ({ people: 0, notified: [], failed: [] })),
}));

const { GET, POST } = await import('@/app/api/cron/board-due/route');

function request(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/board-due', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the board-due route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await POST(request('not-the-secret'))).status).toBe(401);
  });

  it('runs the pass for the secret the cron job carries', async () => {
    const response = await POST(request('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, people: 0, notified: [], failed: [] });
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations-you/0030_board_due_notices.sql'),
  'utf8',
);

const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the board-due schedule', () => {
  it('unschedules the job by name before scheduling it, once a day', () => {
    const unschedule = statements.indexOf("jobname = 'board-due-daily'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
    expect(statements).toContain("'13 8 * * *'");
  });

  it('posts to the route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/board-due'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
  });
});
