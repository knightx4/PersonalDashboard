import { describe, expect, it, vi } from 'vitest';
import { dashFinishedPayload } from './dash-finished';
import {
  runDashFinishedFor,
  type DashFinishedPorts,
  type EndedRun,
  type FinishSettings,
} from './dash-finished-run';
import type { PushPorts, PushSubscriptionRow } from './send';

const NOW = new Date('2026-10-18T12:00:00Z');
const USER = 'user-a';
const THROUGH = '2026-10-18T11:00:00.123456+00:00';

function sub(id: string): PushSubscriptionRow {
  return { id, endpoint: `https://push.example/${id}`, p256dh: 'key', auth: 'secret' };
}

/** The fake push ports of send.test.ts. */
function pushPorts(rows: PushSubscriptionRow[], send: PushPorts['send']): PushPorts {
  return {
    subscriptions: vi.fn(async () => rows),
    send: vi.fn(send),
    forget: vi.fn(async () => undefined),
    sent: vi.fn(async () => undefined),
  };
}

function ports(input: {
  settings?: FinishSettings;
  working?: boolean;
  ended?: EndedRun[];
  inbox?: number;
  push?: PushPorts | null;
}): DashFinishedPorts & { announce: ReturnType<typeof vi.fn>; working: ReturnType<typeof vi.fn> } {
  const push = input.push === undefined ? pushPorts([sub('phone')], async () => 201) : input.push;
  return {
    settings: vi.fn(async () => input.settings ?? { enabled: true, announcedThrough: THROUGH }),
    working: vi.fn(async () => input.working ?? false),
    ended: vi.fn(async () => input.ended ?? []),
    inbox: vi.fn(async () => input.inbox ?? 0),
    announce: vi.fn(async () => undefined),
    push: vi.fn(() => push),
  };
}

const TWO_RUNS: EndedRun[] = [
  { status: 'finished', updatedAt: '2026-10-18T11:40:00.5+00:00' },
  { status: 'finished', updatedAt: '2026-10-18T11:40:00.512345+00:00' },
];

describe('the finished-work pass', () => {
  it('sends one notification for two runs that finished together, and moves past both', async () => {
    const push = pushPorts([sub('phone')], async () => 201);
    const p = ports({ ended: TWO_RUNS, inbox: 4, push });
    const result = await runDashFinishedFor(p, USER, NOW);

    expect(push.send).toHaveBeenCalledTimes(1);
    expect(push.send).toHaveBeenCalledWith(
      sub('phone'),
      JSON.stringify(dashFinishedPayload({ finished: 2, failed: 0, inbox: 4 })),
    );
    expect(p.announce).toHaveBeenCalledWith(USER, '2026-10-18T11:40:00.512345+00:00');
    expect(result).toMatchObject({ kind: 'sent', finished: 2, failed: 0, inbox: 4 });
  });

  it('counts failed runs apart from finished ones', async () => {
    const push = pushPorts([sub('phone')], async () => 201);
    const p = ports({
      ended: [TWO_RUNS[0], { status: 'failed', updatedAt: '2026-10-18T11:50:00+00:00' }],
      push,
    });
    expect(await runDashFinishedFor(p, USER, NOW)).toMatchObject({ kind: 'sent', finished: 1, failed: 1 });
    expect(p.announce).toHaveBeenCalledWith(USER, '2026-10-18T11:50:00+00:00');
  });

  it('asks for runs ended after the last notification and up to now', async () => {
    const p = ports({});
    await runDashFinishedFor(p, USER, NOW);
    expect(p.ended).toHaveBeenCalledWith(USER, THROUGH, NOW);
  });

  it('sends nothing when nothing finished since the last notification', async () => {
    const push = pushPorts([sub('phone')], async () => 201);
    const p = ports({ ended: [], push });
    expect(await runDashFinishedFor(p, USER, NOW)).toEqual({ kind: 'nothing' });
    expect(push.send).not.toHaveBeenCalled();
    expect(p.announce).not.toHaveBeenCalled();
  });

  it('waits while a run is still going, looking back two hours for one', async () => {
    const push = pushPorts([sub('phone')], async () => 201);
    const p = ports({ working: true, ended: TWO_RUNS, push });
    expect(await runDashFinishedFor(p, USER, NOW)).toEqual({ kind: 'working' });
    expect(p.working).toHaveBeenCalledWith(USER, new Date('2026-10-18T10:00:00Z'));
    expect(push.send).not.toHaveBeenCalled();
    expect(p.announce).not.toHaveBeenCalled();
  });

  it('keeps the runs for the next pass when the send fails', async () => {
    const push = pushPorts([sub('phone')], async () => {
      throw Object.assign(new Error('push service down'), { statusCode: 503 });
    });
    const p = ports({ ended: TWO_RUNS, push });
    expect(await runDashFinishedFor(p, USER, NOW)).toMatchObject({ kind: 'sent', through: null });
    expect(p.announce).not.toHaveBeenCalled();
  });

  it('moves on when one device took it and another failed', async () => {
    const push = pushPorts([sub('phone'), sub('laptop')], async (s) => {
      if (s.id === 'laptop') throw new Error('timeout');
      return 201;
    });
    const p = ports({ ended: TWO_RUNS, push });
    await runDashFinishedFor(p, USER, NOW);
    expect(p.announce).toHaveBeenCalledWith(USER, TWO_RUNS[1].updatedAt);
  });

  it('moves on when there is no device to reach, so a later phone is not sent old news', async () => {
    const push = pushPorts([], async () => 201);
    const p = ports({ ended: TWO_RUNS, push });
    await runDashFinishedFor(p, USER, NOW);
    expect(push.send).not.toHaveBeenCalled();
    expect(p.announce).toHaveBeenCalledWith(USER, TWO_RUNS[1].updatedAt);
  });

  it('on the first pass records now and sends nothing, so past runs are not announced', async () => {
    const push = pushPorts([sub('phone')], async () => 201);
    const p = ports({ settings: { enabled: true, announcedThrough: null }, ended: TWO_RUNS, push });
    expect(await runDashFinishedFor(p, USER, NOW)).toEqual({ kind: 'first', through: NOW.toISOString() });
    expect(p.announce).toHaveBeenCalledWith(USER, NOW.toISOString());
    expect(p.ended).not.toHaveBeenCalled();
    expect(push.send).not.toHaveBeenCalled();
  });

  it('does nothing for a person who turned it off', async () => {
    const push = pushPorts([sub('phone')], async () => 201);
    const p = ports({ settings: { enabled: false, announcedThrough: THROUGH }, ended: TWO_RUNS, push });
    expect(await runDashFinishedFor(p, USER, NOW)).toEqual({ kind: 'off' });
    expect(push.send).not.toHaveBeenCalled();
    expect(p.announce).not.toHaveBeenCalled();
  });

  it('leaves the runs unannounced when nothing can be signed', async () => {
    const p = ports({ ended: TWO_RUNS, push: null });
    expect(await runDashFinishedFor(p, USER, NOW)).toEqual({ kind: 'unsigned' });
    expect(p.announce).not.toHaveBeenCalled();
  });
});
