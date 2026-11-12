import { describe, expect, it, vi } from 'vitest';
import {
  CHROME_CONNECTED,
  CHROME_NOT_CONNECTED,
  chromeAnswer,
  chromeReason,
  parseMachine,
  runnerPrompt,
  runnerTick,
  RUNNER_INTERVAL_MS,
  STAND_DOWN_MS,
  startRunner,
  stoppedReason,
  type RunnerDeps,
  type RunnerState,
} from './browser-runner';
import { BROWSER_TASK_LINE, type SessionBriefHandoff } from './handoff-session';

const HANDOFF: SessionBriefHandoff = {
  id: 'h1',
  advisorId: null,
  conversationId: 'c1',
  advisorChatId: null,
  request: 'Download the October statement',
  asked: 'grab my October statement from the bank',
  summary: null,
  refs: [],
};

function deps(over: Partial<RunnerDeps> = {}): RunnerDeps & { calls: string[]; clock: { at: number } } {
  const calls: string[] = [];
  const clock = { at: 1_000_000 };
  return {
    calls,
    clock,
    machine: 'pc',
    userId: 'u1',
    heartbeat: vi.fn(async () => void calls.push('heartbeat')),
    claim: vi.fn(async () => (calls.push('claim'), 'h1')),
    load: vi.fn(async () => (calls.push('load'), HANDOFF)),
    chromeConnected: vi.fn(async () => (calls.push('chrome'), true)),
    release: vi.fn(async () => (calls.push('release'), true)),
    begin: vi.fn(async () => (calls.push('begin'), true)),
    runClaude: vi.fn(async () => (calls.push('claude'), { ok: true, output: '' })),
    status: vi.fn(async () => (calls.push('status'), 'done')),
    closeFailed: vi.fn(async () => void calls.push('closeFailed')),
    newSessionId: () => 's1',
    now: () => clock.at,
    log: () => {},
    ...over,
  };
}

describe('runnerTick', () => {
  it('claims a task, checks Chrome, marks it running and runs Claude Code on the brief with the Chrome lines', async () => {
    const d = deps();
    const result = await runnerTick(d, { quietUntil: 0 });
    expect(result).toEqual({ kind: 'ran', id: 'h1', status: 'done', closedByRunner: false });
    expect(d.calls).toEqual(['claim', 'load', 'chrome', 'begin', 'claude', 'status']);
    const [prompt, session] = vi.mocked(d.runClaude).mock.calls[0];
    expect(session).toBe('s1');
    expect(prompt.split('\n').slice(0, 3)).toEqual(['Hand-off h1', 'kind session', BROWSER_TASK_LINE]);
    expect(prompt).toContain(
      `npx tsx scripts/handoff-session.ts browser h1 --route chrome --reason "${chromeReason('pc')}"`,
    );
    expect(prompt).toContain('"A browser task"');
    expect(prompt).toMatch(/no purchase.*no message.*no form/i);
  });

  it('does nothing when there is no task', async () => {
    const d = deps({ claim: vi.fn(async () => null) });
    expect(await runnerTick(d, { quietUntil: 0 })).toEqual({ kind: 'idle' });
    expect(d.chromeConnected).not.toHaveBeenCalled();
  });

  it('lets the claim go and stays quiet when Chrome is not connected, writing nothing else', async () => {
    const d = deps({ chromeConnected: vi.fn(async () => false) });
    const state: RunnerState = { quietUntil: 0 };
    expect(await runnerTick(d, state)).toEqual({ kind: 'released', id: 'h1' });
    expect(d.release).toHaveBeenCalledWith('h1');
    expect(d.begin).not.toHaveBeenCalled();
    expect(d.runClaude).not.toHaveBeenCalled();
    expect(d.closeFailed).not.toHaveBeenCalled();
    expect(state.quietUntil).toBe(d.clock.at + STAND_DOWN_MS);

    // While quiet it claims nothing, so the Mac or the cloud can take the task.
    d.clock.at += STAND_DOWN_MS - 1;
    expect(await runnerTick(d, state)).toEqual({ kind: 'quiet' });
    expect(d.claim).toHaveBeenCalledTimes(1);
    d.clock.at += 1;
    await runnerTick(d, state);
    expect(d.claim).toHaveBeenCalledTimes(2);
  });

  it('treats a Chrome check that throws as not connected', async () => {
    const d = deps({ chromeConnected: vi.fn(async () => Promise.reject(new Error('no claude'))) });
    expect(await runnerTick(d, { quietUntil: 0 })).toEqual({ kind: 'released', id: 'h1' });
  });

  it('runs nothing when the hand-off was started elsewhere', async () => {
    const d = deps({ begin: vi.fn(async () => false) });
    expect(await runnerTick(d, { quietUntil: 0 })).toEqual({ kind: 'taken', id: 'h1' });
    expect(d.runClaude).not.toHaveBeenCalled();
  });

  it('closes failed a hand-off the session left open, under the same session id', async () => {
    const d = deps({ status: vi.fn(async () => 'fired'), runClaude: vi.fn(async () => ({ ok: false, output: 'boom' })) });
    expect(await runnerTick(d, { quietUntil: 0 })).toEqual({ kind: 'ran', id: 'h1', status: 'fired', closedByRunner: true });
    expect(d.closeFailed).toHaveBeenCalledWith('h1', stoppedReason('pc'), 's1');
  });

  it('lets go of a claim whose hand-off is no longer open', async () => {
    const d = deps({ load: vi.fn(async () => null) });
    expect(await runnerTick(d, { quietUntil: 0 })).toEqual({ kind: 'gone', id: 'h1' });
    expect(d.release).toHaveBeenCalledWith('h1');
    expect(d.chromeConnected).not.toHaveBeenCalled();
  });
});

describe('startRunner', () => {
  it('sends a heartbeat at start and every interval, and none while quiet', async () => {
    const stop = new AbortController();
    let beat: () => void = () => {};
    let passes = 0;
    const d = deps({ claim: vi.fn(async () => null) });
    const intervals: number[] = [];
    await startRunner(d, {
      signal: stop.signal,
      setInterval: (run, ms) => {
        beat = run;
        intervals.push(ms);
        return 1;
      },
      clearInterval: () => {},
      sleep: async () => {
        passes += 1;
        if (passes === 3) stop.abort();
      },
    });
    expect(intervals).toEqual([RUNNER_INTERVAL_MS]);
    expect(d.heartbeat).toHaveBeenCalledTimes(1);
    expect(d.claim).toHaveBeenCalledTimes(3);
    beat();
    beat();
    await Promise.resolve();
    expect(d.heartbeat).toHaveBeenCalledTimes(3);
  });

  it('stops the heartbeat after Chrome did not answer', async () => {
    const stop = new AbortController();
    let beat: () => void = () => {};
    const d = deps({ chromeConnected: vi.fn(async () => false) });
    await startRunner(d, {
      signal: stop.signal,
      setInterval: (run) => ((beat = run), 1),
      clearInterval: () => {},
      sleep: async () => stop.abort(),
    });
    expect(d.heartbeat).toHaveBeenCalledTimes(1);
    beat();
    await Promise.resolve();
    expect(d.heartbeat).toHaveBeenCalledTimes(1);
    d.clock.at += STAND_DOWN_MS;
    beat();
    await Promise.resolve();
    expect(d.heartbeat).toHaveBeenCalledTimes(2);
  });

  it('goes straight on to the next task after one ran', async () => {
    const stop = new AbortController();
    const ids = ['h1', 'h2', null];
    const d = deps({ claim: vi.fn(async () => ids.shift() ?? null) });
    await startRunner(d, {
      signal: stop.signal,
      setInterval: () => 1,
      clearInterval: () => {},
      sleep: async () => stop.abort(),
    });
    expect(d.runClaude).toHaveBeenCalledTimes(2);
    expect(d.claim).toHaveBeenCalledTimes(3);
  });
});

describe('the small parts', () => {
  it('reads the machine', () => {
    expect(parseMachine('pc')).toBe('pc');
    expect(parseMachine(' Mac ')).toBe('mac');
    expect(parseMachine('linux')).toBeNull();
    expect(parseMachine(undefined)).toBeNull();
  });

  it('reads the Chrome check, taking anything unclear as not connected', () => {
    expect(chromeAnswer(`Tabs listed.\n${CHROME_CONNECTED}`)).toBe(true);
    expect(chromeAnswer(CHROME_NOT_CONNECTED)).toBe(false);
    expect(chromeAnswer('I could not tell')).toBe(false);
  });

  it('names the computer in the reason', () => {
    expect(chromeReason('mac')).toBe('Ran on your Mac in Chrome.');
    expect(runnerPrompt(HANDOFF, 'u1', 'mac')).toContain('Ran on your Mac in Chrome.');
  });
});
