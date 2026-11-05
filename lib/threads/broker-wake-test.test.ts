import { describe, expect, it } from 'vitest';
import {
  GIVE_UP_MS,
  TRIAL_COUNT,
  median,
  reportOf,
  trialOf,
  wakeText,
  type MessageRow,
  type ThreadRow,
} from './broker-wake-test';

const T0 = Date.parse('2026-11-05T10:00:00.000Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

function thread(n: number, id = `t${n}`): ThreadRow {
  return { id, title: `Wake test abc123 #${n}`, state: 'queued', created_at: at(0) };
}
function person(id: string, deliveredAfter: number | null): MessageRow {
  return {
    thread_id: id,
    author: 'person',
    kind: 'text',
    body: 'x',
    created_at: at(0),
    delivered_at: deliveredAfter === null ? null : at(deliveredAfter),
  };
}
function session(id: string, kind: string, body: string, after: number): MessageRow {
  return { thread_id: id, author: 'session', kind, body, created_at: at(after), delivered_at: null };
}

describe('the wake text', () => {
  it('names the thread and asks for the three steps', () => {
    const text = wakeText('thread-1', 3);
    expect(text).toContain('3 of 10');
    expect(text.match(/thread-1/g)?.length).toBe(3);
    expect(text).toContain('create_session');
  });
});

describe('median', () => {
  it('takes the middle, or the mean of the two middle values', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 10])).toBe(3);
  });
});

describe('one trial', () => {
  it('ignores a thread that is not a wake test', () => {
    expect(trialOf({ ...thread(1), title: 'Fix the footer' }, [person('t1', null)], T0)).toBeNull();
  });

  it('times the broker from the read and the child from its reply', () => {
    const trial = trialOf(
      thread(1),
      [person('t1', 8), session('t1', 'status', 'broker: turn started', 6), session('t1', 'text', 'child: connector loaded', 70)],
      T0 + 100_000,
    )!;
    expect(trial).toMatchObject({ status: 'replied', brokerMs: 6000, childMs: 70_000, childHasConnector: true });
  });

  it('waits, then times out and records a child with no connector', () => {
    const messages = [person('t1', 5)];
    expect(trialOf(thread(1), messages, T0 + 60_000)).toMatchObject({ status: 'waiting', childHasConnector: null });
    expect(trialOf(thread(1), messages, T0 + GIVE_UP_MS + 1000)).toMatchObject({
      status: 'timed_out',
      brokerMs: 5000,
      childHasConnector: false,
    });
  });

  it('reads a failed fire', () => {
    const trial = trialOf(thread(1), [person('t1', null), session('t1', 'status', 'fire failed: 401', 1)], T0)!;
    expect(trial).toMatchObject({ status: 'fire_failed', error: '401', brokerMs: null });
  });
});

describe('the report', () => {
  const replied = (n: number, childSeconds: number) =>
    trialOf(
      thread(n),
      [person(`t${n}`, 4), session(`t${n}`, 'text', 'child', childSeconds)],
      T0 + 600_000,
    )!;

  it('is unfinished until ten trials have an outcome', () => {
    const report = reportOf('abc123', [replied(1, 60)]);
    expect(report.finished).toBe(false);
    expect(report.verdict).toContain('1 of 10');
  });

  it('keeps the broker when all ten reply within three minutes', () => {
    const trials = Array.from({ length: TRIAL_COUNT }, (_, i) => replied(i + 1, 30 + i * 10));
    const report = reportOf('abc123', trials);
    expect(report).toMatchObject({
      finished: true,
      childMedianMs: 75_000,
      childWorstMs: 120_000,
      childrenHaveConnector: true,
      writeDecision: false,
    });
    expect(report.verdict).toContain('keep the subscription broker');
  });

  it('asks for the fallback decision when a reply is over three minutes', () => {
    const trials = Array.from({ length: TRIAL_COUNT }, (_, i) => replied(i + 1, i === 4 ? 200 : 40));
    const report = reportOf('abc123', trials);
    expect(report.writeDecision).toBe(true);
    expect(report.childWorstMs).toBe(200_000);
  });

  it('stops at a failed fire and asks for the decision', () => {
    const failed = trialOf(thread(1), [person('t1', null), session('t1', 'status', 'fire failed: 401', 1)], T0)!;
    const report = reportOf('abc123', [failed]);
    expect(report.finished).toBe(true);
    expect(report.writeDecision).toBe(true);
  });
});
