import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupStillOwed, keepRenewing, owedGroupReply, SETTLE_MAX_MS, SETTLE_QUIET_MS, settleWaitMs, waitForQuiet, waitingLast } from './reply-turn';

describe('settleWaitMs (plan #2988)', () => {
  const now = Date.parse('2026-11-06T10:00:10Z');
  it('waits out the rest of the quiet spell after the newest text', () => {
    expect(settleWaitMs('2026-11-06T10:00:09Z', now, 0)).toBe(SETTLE_QUIET_MS - 1_000);
  });
  it('goes at once when the person has been quiet long enough, or wrote nothing', () => {
    expect(settleWaitMs('2026-11-06T10:00:00Z', now, 0)).toBe(0);
    expect(settleWaitMs(null, now, 0)).toBe(0);
  });
  it('never waits past the most, nor longer than one spell when the clocks disagree', () => {
    expect(settleWaitMs('2026-11-06T10:00:10Z', now, SETTLE_MAX_MS)).toBe(0);
    expect(settleWaitMs('2026-11-06T10:00:10Z', now, SETTLE_MAX_MS - 400)).toBe(400);
    expect(settleWaitMs('2026-11-06T10:01:00Z', now, 0)).toBe(SETTLE_QUIET_MS);
  });
});

describe('waitForQuiet', () => {
  it('keeps waiting while texts keep coming, then stops', async () => {
    let clock = 0;
    const sent = [0, 1_000, 2_500];
    const slept: number[] = [];
    await waitForQuiet(async () => new Date(sent.filter((t) => t <= clock).at(-1) ?? 0).toISOString(), {
      now: () => clock,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
    });
    // Quiet from the third text, at 2.5s, until 5s.
    expect(clock).toBe(5_000);
    expect(slept.length).toBeGreaterThanOrEqual(2);
  });
});

describe('waitingLast', () => {
  it('moves the texts no reply has read after the reply they were sent during', () => {
    const thread = [
      { id: 'a', role: 'person' },
      { id: 'b', role: 'person' },
      { id: 'r1', role: 'advisor' },
      { id: 'r2', role: 'advisor' },
    ];
    expect(waitingLast(thread, new Set(['b'])).map((m) => m.id)).toEqual(['a', 'r1', 'r2', 'b']);
    expect(waitingLast(thread, new Set()).map((m) => m.id)).toEqual(['a', 'b', 'r1', 'r2']);
  });
});

describe('keepRenewing', () => {
  afterEach(() => vi.useRealTimers());

  it('lets a renewal already sent land before stop returns, so none comes after the release', async () => {
    vi.useFakeTimers();
    const landed: string[] = [];
    let finish: () => void = () => undefined;
    const keeper = keepRenewing(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            landed.push('renewed');
            resolve();
          };
        }),
      4_000,
    );
    vi.advanceTimersByTime(4_000);
    const stopping = keeper.stop().then(() => landed.push('stopped'));
    await Promise.resolve();
    expect(landed).toEqual([]);
    finish();
    await stopping;
    // The release follows stop, after the renewal it waited for.
    expect(landed).toEqual(['renewed', 'stopped']);
    vi.advanceTimersByTime(20_000);
    expect(landed).toEqual(['renewed', 'stopped']);
  });
});

describe('owedGroupReply (plan #2988.3)', () => {
  it('is the newest message when it is theirs', () => {
    const last = { id: 'b', role: 'person' };
    expect(owedGroupReply([{ id: 'a', role: 'advisor' }, last])).toBe(last);
  });

  it('is nothing once a bot spoke after it, since a burst marks nothing delivered', () => {
    expect(owedGroupReply([{ id: 'a', role: 'person' }, { id: 'b', role: 'advisor' }])).toBeNull();
    expect(owedGroupReply([])).toBeNull();
  });
});

describe('groupStillOwed (plan #2988.3)', () => {
  const textAt = '2026-11-06T10:00:00Z';

  it('is not owed when a burst asked for after the text ended quietly', () => {
    expect(groupStillOwed({ replyStatus: 'idle', requestedAt: '2026-11-06T10:00:01Z' }, textAt)).toBe(false);
  });

  it('is owed when the burst ended before the text was sent', () => {
    expect(groupStillOwed({ replyStatus: 'idle', requestedAt: '2026-11-06T09:59:00Z' }, textAt)).toBe(true);
  });

  it('is owed when a burst died while waiting, or failed', () => {
    expect(groupStillOwed({ replyStatus: 'waiting', requestedAt: '2026-11-06T10:00:01Z' }, textAt)).toBe(true);
    expect(groupStillOwed({ replyStatus: 'failed', requestedAt: '2026-11-06T10:00:01Z' }, textAt)).toBe(true);
    expect(groupStillOwed({ replyStatus: null, requestedAt: null }, textAt)).toBe(true);
  });
});
