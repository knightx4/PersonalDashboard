import { describe, expect, it, vi } from 'vitest';
import { CLOUD_FALLBACK_LINE, cloudFailedLine, runBrowserWait, type BrowserWaitPorts } from './browser-wait';
import type { FireSessionResult } from './handoff-fire';
import type { SessionHandoff } from './handoffs';

const task = (id: string): SessionHandoff => ({
  id,
  advisorId: null,
  conversationId: 'c1',
  advisorChatId: null,
  request: 'Check the opening hours on the gym site',
  asked: 'check the gym hours',
  summary: null,
  refs: [],
  subjectRef: null,
  requestKey: `k-${id}`,
  state: 'queued',
  runId: null,
  error: null,
  costMicros: null,
  createdAt: '2026-11-07T09:00:00Z',
  firedAt: null,
  finishedAt: null,
  lastSeenAt: null,
  browserTask: true,
  browser: null,
  browserReason: null,
});

const NOW = new Date('2026-11-07T09:05:00Z');

function ports(over: Partial<BrowserWaitPorts> & { fired?: Record<string, FireSessionResult> }) {
  const said: [string, string][] = [];
  const p: BrowserWaitPorts = {
    releaseStale: over.releaseStale ?? (async () => 0),
    waited: over.waited ?? (async () => []),
    fire:
      over.fire ??
      (async (h) => over.fired?.[h.id] ?? { state: 'running', runId: 'cse_1', error: null, started: true }),
    say: over.say ?? (async (h, text) => void said.push([h.id, text])),
  };
  return { p, said };
}

describe('runBrowserWait', () => {
  it('reads only tasks kept at least the wait ago', async () => {
    const waited = vi.fn(async () => []);
    await runBrowserWait(ports({ waited }).p, NOW, 3 * 60_000);
    expect(waited).toHaveBeenCalledWith('2026-11-07T09:02:00.000Z');
  });

  it('starts the cloud session on a task no computer took, and says so in the thread', async () => {
    const { p, said } = ports({ waited: async () => [task('h1')] });
    const result = await runBrowserWait(p, NOW, 3 * 60_000);
    expect(result).toEqual({ released: 0, started: ['h1'], failed: [], skipped: [] });
    expect(said).toEqual([['h1', CLOUD_FALLBACK_LINE]]);
    expect(CLOUD_FALLBACK_LINE).toContain('public pages');
  });

  it('starts nothing and says nothing for a task a computer took before the fire', async () => {
    const { p, said } = ports({
      waited: async () => [task('h1')],
      fired: { h1: { state: 'running', runId: null, error: null, started: false } },
    });
    const result = await runBrowserWait(p, NOW, 3 * 60_000);
    expect(result.skipped).toEqual(['h1']);
    expect(result.started).toEqual([]);
    expect(said).toEqual([]);
  });

  it('tells the thread why when the cloud session would not start', async () => {
    const { p, said } = ports({
      waited: async () => [task('h1')],
      fired: { h1: { state: 'failed', runId: null, error: 'The session could not be started: 401.', started: false } },
    });
    const result = await runBrowserWait(p, NOW, 3 * 60_000);
    expect(result.failed).toEqual(['h1']);
    expect(said[0][1]).toBe(cloudFailedLine('The session could not be started: 401.'));
    expect(said[0][1]).toContain('started: 401. Nothing has been done');
  });

  it('lets go of quiet claims before reading, and carries on past one that throws', async () => {
    const order: string[] = [];
    const { p, said } = ports({
      releaseStale: async () => {
        order.push('release');
        return 2;
      },
      waited: async () => {
        order.push('read');
        return [task('h1'), task('h2')];
      },
      fire: async (h) => {
        if (h.id === 'h1') throw new Error('network');
        return { state: 'running', runId: 'cse_2', error: null, started: true };
      },
    });
    const result = await runBrowserWait(p, NOW, 3 * 60_000);
    expect(order).toEqual(['release', 'read']);
    expect(result).toEqual({ released: 2, started: ['h2'], failed: ['h1'], skipped: [] });
    expect(said).toEqual([['h2', CLOUD_FALLBACK_LINE]]);
  });
});
