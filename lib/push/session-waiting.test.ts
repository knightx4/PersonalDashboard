import { describe, expect, it, vi } from 'vitest';
import type { PushPorts } from './send';
import { PER_PASS, runSessionWaiting, sessionWaitingPayload, type SessionWaitingPorts, type WaitingSession } from './session-waiting';

const NOW = new Date('2026-11-04T12:00:00Z');

function row(id: string, extra: Partial<WaitingSession> = {}): WaitingSession {
  return { id, userId: 'u1', about: '#2800.4 Send what waits on you', needs: 'CSV or JSON for the export?', ...extra };
}

function devices(status = 201): PushPorts {
  return {
    subscriptions: async () => [{ id: 's1', endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' }],
    send: vi.fn(async () => status),
    forget: vi.fn(async () => undefined),
    sent: vi.fn(async () => undefined),
  };
}

function ports(rows: WaitingSession[], push: PushPorts | null) {
  const announce = vi.fn(async () => undefined);
  const unannounced = vi.fn(async () => rows);
  const out: SessionWaitingPorts = { unannounced, announce, push: () => push };
  return { out, announce, unannounced };
}

describe('sessionWaitingPayload', () => {
  it('names the work, carries the question, opens the Inbox and stacks per row', () => {
    const payload = sessionWaitingPayload(row('r1'));
    expect(payload.title).toContain('#2800.4');
    expect(payload.body).toBe('CSV or JSON for the export?');
    expect(payload.url).toBe('/goals/inbox');
    expect(payload.tag).toBe('session-waiting-r1');
  });
});

describe('runSessionWaiting', () => {
  it('sends one push per waiting row and marks them announced', async () => {
    const phone = devices();
    const { out, announce } = ports([row('a'), row('b')], phone);
    const result = await runSessionWaiting(out, NOW);
    expect(result).toEqual({ announced: 2, unsigned: 0, failed: 0 });
    expect(phone.send).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenCalledWith(['a', 'b'], NOW);
  });

  it('asks for rows no older than three days and at most one pass worth', async () => {
    const { out, unannounced } = ports([], devices());
    await runSessionWaiting(out, NOW);
    expect(unannounced).toHaveBeenCalledWith(new Date('2026-11-01T12:00:00Z'), PER_PASS);
  });

  it('leaves rows for the next pass when nothing can be signed', async () => {
    const { out, announce } = ports([row('a')], null);
    expect(await runSessionWaiting(out, NOW)).toEqual({ announced: 0, unsigned: 1, failed: 0 });
    expect(announce).not.toHaveBeenCalled();
  });

  it('settles a row with no device to reach, and keeps one whose send failed everywhere', async () => {
    const none: PushPorts = { ...devices(), subscriptions: async () => [] };
    const first = ports([row('a')], none);
    expect(await runSessionWaiting(first.out, NOW)).toMatchObject({ announced: 1 });

    const broken: PushPorts = { ...devices(), send: async () => { throw new Error('down'); } };
    const second = ports([row('b')], broken);
    expect(await runSessionWaiting(second.out, NOW)).toMatchObject({ announced: 0, failed: 1 });
    expect(second.announce).not.toHaveBeenCalled();
  });
});
