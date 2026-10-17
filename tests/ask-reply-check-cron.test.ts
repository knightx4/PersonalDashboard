/**
 * The clock behind the weekly check of Ask Dash replies (plan #2285.3): the
 * route that runs it and the pg_cron job that calls it.
 *
 * The route can spend model budget and is reachable by anything that knows its
 * URL, so the shared secret is checked on both verbs. The schedule lives in a
 * migration that is applied once and not read again, so what the run depends
 * on is asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/inngest/core/ask-reply-check', () => ({
  runAskReplyCheck: vi.fn(async () => ({ userId: 'owner', result: { status: 'quiet', week: '2026-10-12', chats: 0 } })),
}));

const { GET, POST } = await import('@/app/api/cron/ask-reply-check/route');
const { runAskReplyCheck } = await import('@/inngest/core/ask-reply-check');
const { weekToCheck } = await import('@/lib/ask/reply-check');

function request(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/ask-reply-check', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the ask reply check route', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'secret-token';
    vi.mocked(runAskReplyCheck).mockClear();
  });

  it('refuses a request without the shared secret, on both verbs', async () => {
    expect((await GET(request(null))).status).toBe(401);
    expect((await POST(request('not-the-secret'))).status).toBe(401);
    expect(runAskReplyCheck).not.toHaveBeenCalled();
  });

  it('runs the check for the secret the cron job carries', async () => {
    const response = await POST(request('secret-token'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, userId: 'owner', result: { status: 'quiet' } });
    expect(runAskReplyCheck).toHaveBeenCalled();
  });
});

const migration = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations/0255_ask_reply_check_cron.sql'),
  'utf8',
);
const statements = migration
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the ask reply check schedule', () => {
  it('unschedules the job by name before scheduling it, and calls the route', () => {
    const unschedule = statements.indexOf("jobname = 'ask-reply-check-weekly'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
    expect(statements).toContain("'/api/cron/ask-reply-check'");
  });

  it('fires on Mondays at hours that are Monday daytime in New York in either season, checking the week just gone', () => {
    const match = statements.match(/'(\d+) (\d+),(\d+) \* \* 1'/);
    expect(match).not.toBeNull();
    const [, minute, ...hours] = match!;
    for (const monday of ['2026-07-06', '2026-01-05']) {
      for (const hour of hours) {
        const at = new Date(`${monday}T${hour.padStart(2, '0')}:${minute.padStart(2, '0')}:00Z`);
        const local = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          weekday: 'short',
          hour: 'numeric',
          hour12: false,
        }).formatToParts(at);
        expect(local.find((part) => part.type === 'weekday')?.value).toBe('Mon');
        const localHour = Number(local.find((part) => part.type === 'hour')?.value);
        expect(localHour).toBeGreaterThanOrEqual(6);
        expect(weekToCheck(at)).toBe(
          new Date(Date.parse(`${monday}T00:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10),
        );
      }
    }
  });

  it('keeps to the database: no rows are changed', () => {
    expect(statements).not.toMatch(/\b(insert|update|delete)\b\s/i);
  });
});
