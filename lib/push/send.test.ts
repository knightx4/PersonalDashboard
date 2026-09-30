import { describe, expect, it, vi } from 'vitest';
import { briefPayload, sendToPerson, type PushPorts, type PushSubscriptionRow } from './send';

const NOW = new Date('2026-09-28T06:05:00Z');
const BRIEF = { day: '2026-09-28', title: 'Respark hiring screen', body: 'Interview today at 10:30 AM.' };

function sub(id: string): PushSubscriptionRow {
  return { id, endpoint: `https://push.example/${id}`, p256dh: 'key', auth: 'secret' };
}

function ports(rows: PushSubscriptionRow[], send: PushPorts['send']): PushPorts {
  return {
    subscriptions: vi.fn(async () => rows),
    send: vi.fn(send),
    forget: vi.fn(async () => undefined),
    sent: vi.fn(async () => undefined),
  };
}

describe('the brief notification', () => {
  it('carries the stored title and body and opens the home page, one per day', () => {
    expect(
      briefPayload({
        day: '2026-09-28',
        title: '  Respark hiring screen ',
        body: '  Interview today at 10:30 AM (with Dana).  Reply to Maya: waiting on your reply for 3 days. ',
      }),
    ).toEqual({
      title: 'Respark hiring screen',
      body: 'Interview today at 10:30 AM (with Dana). Reply to Maya: waiting on your reply for 3 days.',
      url: '/home?brief=2026-09-28#brief',
      tag: 'day-brief-2026-09-28',
    });
  });

  it('says "Your day" for a row written before titles, and never sends past a lock screen', () => {
    const payload = briefPayload({ day: '2026-09-28', title: null, body: 'word '.repeat(100) });
    expect(payload.title).toBe('Your day');
    expect(payload.body.length).toBeLessThanOrEqual(180);
    expect(payload.body.endsWith('…')).toBe(true);
    expect(briefPayload({ day: '2026-09-28', title: 'a'.repeat(80), body: 'x' }).title).toHaveLength(50);
  });

  it('sends to every browser the person switched it on for', async () => {
    const p = ports([sub('phone'), sub('laptop')], async () => 201);
    const payload = briefPayload(BRIEF);
    expect(await sendToPerson(p, 'user-a', payload, NOW)).toEqual({ sent: 2, forgotten: 0, failed: 0 });
    expect(p.subscriptions).toHaveBeenCalledWith('user-a');
    expect(p.send).toHaveBeenCalledWith(sub('phone'), JSON.stringify(payload));
    expect(p.sent).toHaveBeenCalledWith(['phone', 'laptop'], NOW);
    expect(p.forget).not.toHaveBeenCalled();
  });

  it('sends nothing when the switch is off everywhere', async () => {
    const p = ports([], async () => 201);
    expect(await sendToPerson(p, 'user-a', briefPayload(BRIEF), NOW)).toEqual({
      sent: 0,
      forgotten: 0,
      failed: 0,
    });
    expect(p.send).not.toHaveBeenCalled();
  });

  it('forgets a subscription the push service says is gone', async () => {
    const p = ports([sub('removed'), sub('expired'), sub('phone')], async (row) => {
      if (row.id === 'removed') throw Object.assign(new Error('Gone'), { statusCode: 410 });
      if (row.id === 'expired') throw Object.assign(new Error('Not found'), { statusCode: 404 });
      return 201;
    });
    expect(await sendToPerson(p, 'user-a', briefPayload(BRIEF), NOW)).toEqual({
      sent: 1,
      forgotten: 2,
      failed: 0,
    });
    expect(vi.mocked(p.forget).mock.calls[0][0].sort()).toEqual(['expired', 'removed']);
  });

  it('keeps a subscription through any other failure', async () => {
    const p = ports([sub('phone')], async () => {
      throw Object.assign(new Error('Service unavailable'), { statusCode: 503 });
    });
    expect(await sendToPerson(p, 'user-a', briefPayload(BRIEF), NOW)).toEqual({
      sent: 0,
      forgotten: 0,
      failed: 1,
    });
    expect(p.forget).not.toHaveBeenCalled();
    expect(p.sent).not.toHaveBeenCalled();
  });
});
