import { describe, expect, it } from 'vitest';
import { durationWords, sessionStatus, type SessionStatusInput } from './handoff-status';

const NOW = Date.parse('2026-11-06T12:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60000).toISOString();

function row(over: Partial<SessionStatusInput>): SessionStatusInput {
  return {
    id: 'h1',
    sender: null,
    request: 'Make the page',
    state: 'queued',
    error: null,
    createdAt: minutesAgo(30),
    firedAt: null,
    finishedAt: null,
    lastSeenAt: null,
    ...over,
  };
}

describe('durationWords', () => {
  it('reads minutes, hours and days', () => {
    expect(durationWords(20_000)).toBe('under a minute');
    expect(durationWords(4 * 60000)).toBe('4 min');
    expect(durationWords(125 * 60000)).toBe('2 h 5 min');
    expect(durationWords(120 * 60000)).toBe('2 h');
    expect(durationWords(49 * 3600000)).toBe('2 days');
  });
});

describe('sessionStatus', () => {
  it('counts a queued hand-off from when it was asked, and names Dash for a null sender', () => {
    const s = sessionStatus(row({}), NOW);
    expect(s).toMatchObject({ sender: 'Dash', state: 'queued', stateWord: 'Waiting to start', duration: '30 min' });
    expect(s.line).toBe('Waiting to start for 30 min.');
  });

  it('counts a running one from when it started', () => {
    const s = sessionStatus(row({ state: 'running', sender: 'Maya', firedAt: minutesAgo(10), lastSeenAt: minutesAgo(1) }), NOW);
    expect(s.sender).toBe('Maya');
    expect(s.line).toBe('Working for 10 min.');
  });

  it('says a running session has gone quiet', () => {
    const s = sessionStatus(row({ state: 'running', firedAt: minutesAgo(50), lastSeenAt: minutesAgo(40) }), NOW);
    expect(s.line).toBe('Working for 50 min, but nothing heard from it for 40 min.');
  });

  it('measures a finished one from start to finish', () => {
    const s = sessionStatus(row({ state: 'done', firedAt: minutesAgo(20), finishedAt: minutesAgo(5) }), NOW);
    expect(s.line).toBe('Done in 15 min.');
  });

  it('gives the reason a failed one stopped', () => {
    const s = sessionStatus(row({ state: 'failed', firedAt: minutesAgo(9), finishedAt: minutesAgo(8), error: 'Session ended\nearly' }), NOW);
    expect(s.line).toBe('Stopped after 1 min: Session ended early');
  });

  it('cuts a long request to one line', () => {
    const s = sessionStatus(row({ request: `${'word '.repeat(80)}` }), NOW);
    expect(s.purpose.length).toBeLessThanOrEqual(140);
    expect(s.purpose.endsWith('…')).toBe(true);
  });
});
