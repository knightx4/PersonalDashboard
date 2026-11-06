/**
 * The mentors' texts on the phone (plan #2748.7): the pass that announces
 * each new text, the route that runs it, and the pg_cron job that calls it.
 *
 * The schedule lives in a migration that is applied once and not read again,
 * so what the run depends on is asserted here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CouncilTextPorts, PendingText } from '@/inngest/you/council-texts';

vi.mock('server-only', () => ({}));
vi.mock('@/inngest/core/day-brief', () => ({ pushPorts: vi.fn() }));
vi.mock('@/inngest/you/council-tick', () => ({ runCouncilTick: vi.fn(async () => ({ skipped: 'test' })) }));

const { runCouncilTextsWith } = await import('@/inngest/you/council-texts');

const TEXTS: PendingText[] = [
  { id: 'm1', userId: 'u1', mentorName: 'The CFO', text: 'Your card bill rose by a third.\nWorth a look.' },
  { id: 'm2', userId: 'u1', mentorName: 'Jerwyn the Elder', text: 'You said Friday for the Brex email.' },
];

function ports(over: Partial<CouncilTextPorts> = {}): CouncilTextPorts {
  return {
    pending: async () => TEXTS,
    timezone: async () => 'America/New_York',
    push: () => ({}) as never,
    pushed: vi.fn(async () => {}),
    send: vi.fn(async () => ({ sent: 1, forgotten: 0, failed: 0 })),
    ...over,
  };
}

// 10:00 in New York, and 23:00 in New York.
const DAY = new Date('2026-11-04T15:00:00Z');
const NIGHT = new Date('2026-11-05T04:00:00Z');

describe('one pass of the mentor texts', () => {
  it('sends one notification per text, naming the mentor and its first line, then records them', async () => {
    const p = ports();
    const summary = await runCouncilTextsWith(p, DAY);
    expect(p.send).toHaveBeenCalledTimes(2);
    expect(vi.mocked(p.send).mock.calls[0][2]).toEqual({
      title: 'The CFO',
      body: 'Your card bill rose by a third.',
      url: '/chat',
      tag: 'council-text-m1',
    });
    expect(p.pushed).toHaveBeenCalledWith('u1', ['m1', 'm2'], DAY);
    expect(summary.sent).toEqual([{ userId: 'u1', texts: 2 }]);
  });

  it('holds every text in quiet hours, to be sent in the morning', async () => {
    const p = ports();
    const summary = await runCouncilTextsWith(p, NIGHT);
    expect(p.send).not.toHaveBeenCalled();
    expect(p.pushed).not.toHaveBeenCalled();
    expect(summary.held).toEqual(['u1']);
  });

  it('tries a text again when the push service failed every phone, and records one with no phone', async () => {
    let n = 0;
    const p = ports({
      send: vi.fn(async () => (n++ === 0 ? { sent: 0, forgotten: 0, failed: 1 } : { sent: 0, forgotten: 0, failed: 0 })),
    });
    await runCouncilTextsWith(p, DAY);
    expect(p.pushed).toHaveBeenCalledWith('u1', ['m2'], DAY);
  });

  it('leaves them unannounced without the signing keys', async () => {
    const p = ports({ push: () => null });
    await runCouncilTextsWith(p, DAY);
    expect(p.send).not.toHaveBeenCalled();
    expect(p.pushed).not.toHaveBeenCalled();
  });

  it('looks back one day only', async () => {
    const pending = vi.fn(async () => [] as PendingText[]);
    await runCouncilTextsWith(ports({ pending }), DAY);
    expect(pending).toHaveBeenCalledWith(new Date(DAY.getTime() - 24 * 60 * 60 * 1000));
  });
});

vi.mock('@/inngest/you/council-texts', async (original) => ({
  ...(await original<typeof import('@/inngest/you/council-texts')>()),
  runCouncilTexts: vi.fn(async () => ({ texts: 0, sent: [], held: [], failed: [], round: { skipped: 'quiet' } })),
}));

const { GET, POST } = await import('@/app/api/cron/council-texts/route');

function request(token: string | null) {
  const headers = new Headers({ host: 'example.test', 'x-forwarded-proto': 'https' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://example.test/api/cron/council-texts', {
    method: 'POST',
    headers,
  }) as unknown as Parameters<typeof GET>[0];
}

describe('the council-texts route', () => {
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
    expect(await response.json()).toEqual({
      ok: true,
      texts: 0,
      sent: [],
      held: [],
      failed: [],
      round: { skipped: 'quiet' },
    });
  });
});

const statements = readFileSync(
  join(import.meta.dirname, '..', 'supabase/migrations-you/0039_council_texts.sql'),
  'utf8',
)
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n');

describe('the council-texts schedule', () => {
  it('unschedules the job by name before scheduling it, every five minutes', () => {
    const unschedule = statements.indexOf("jobname = 'council-texts-five-minutes'");
    const schedule = statements.indexOf('cron.schedule(');
    expect(unschedule).toBeGreaterThan(-1);
    expect(unschedule).toBeLessThan(schedule);
    expect(statements).toContain("'*/5 * * * *'");
  });

  it('posts to the route, reading the origin and secret from Vault', () => {
    expect(statements).toContain("'/api/cron/council-texts'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'app_origin'");
    expect(statements).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
  });

  it('backfills pushed_at for the owner alone', () => {
    expect(statements).toMatch(/update you\.advisor_messages\s+set pushed_at = created_at\s+where user_id = core\.dev_owner_id\(\)/);
  });
});
