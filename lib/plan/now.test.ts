import { describe, expect, it } from 'vitest';
import { isStale, nowSessions, withoutTitle, type GoingRun, type NowStep, type ProgressRow } from './now';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const steps = new Map<string, NowStep>([
  ['s1', { id: 's1', ref: '#2800.3', title: 'Show what is running now', href: '/dev/plan/2803', module: 'dev' }],
  ['s2', { id: 's2', ref: '#12.1', title: 'Add the RSS feed', href: '/dev/plan/9001', module: 'website' }],
  ['s3', { id: 's3', ref: '#2800.4', title: 'Send what waits to the Inbox', href: '/dev/plan/2804', module: 'dev' }],
]);

function report(over: Partial<ProgressRow>): ProgressRow {
  return {
    sessionId: 'cse_a',
    planItemId: 's1',
    planRunId: null,
    threadId: null,
    project: null,
    state: 'working',
    action: 'Claimed #2800.3',
    needs: null,
    startedAt: ago(30),
    updatedAt: ago(2),
    ...over,
  };
}

function run(over: Partial<GoingRun>): GoingRun {
  return {
    runId: 'r9',
    planItemId: 's3',
    startedAt: ago(40),
    status: 'started',
    liveness: 'working',
    lastPush: { at: ago(5), subject: 'Draft the inbox row' },
    lastLineAt: null,
    ...over,
  };
}

const base = { progress: [], going: [], steps, questions: [], endedRuns: new Set<string>(), scope: null, now: NOW };

describe('nowSessions', () => {
  it('lists a reporting session with its line and when it reported', () => {
    const { sessions } = nowSessions({ ...base, progress: [report({})] });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ source: 'report', state: 'working', action: 'Claimed #2800.3', at: ago(2) });
    expect(sessions[0].step?.ref).toBe('#2800.3');
  });

  it('keeps the push-based guess for a run whose session does not report', () => {
    const { sessions } = nowSessions({ ...base, going: [run({})] });
    expect(sessions[0]).toMatchObject({ source: 'guess', action: 'Pushed: Draft the inbox row', at: ago(5) });
  });

  it('drops the guess once the run or its step has a report', () => {
    const byRun = nowSessions({ ...base, progress: [report({ planItemId: 's1', planRunId: 'r9' })], going: [run({})] });
    expect(byRun.sessions.map((s) => s.source)).toEqual(['report']);
    const byStep = nowSessions({ ...base, progress: [report({ planItemId: 's3' })], going: [run({})] });
    expect(byStep.sessions.map((s) => s.source)).toEqual(['report']);
  });

  it('puts what waits on you first, with its run question to answer', () => {
    const { sessions } = nowSessions({
      ...base,
      progress: [
        report({ sessionId: 'cse_b', updatedAt: ago(1) }),
        report({ planItemId: 's3', planRunId: 'r2', state: 'waiting', needs: 'CSV or JSON?', updatedAt: ago(9) }),
      ],
      questions: [{ runId: 'r2', body: 'CSV or JSON?', options: ['CSV', 'JSON'] }],
    });
    expect(sessions[0]).toMatchObject({ state: 'waiting', needs: 'CSV or JSON?' });
    expect(sessions[0].question?.options).toEqual(['CSV', 'JSON']);
  });

  it('on a project page lists only that project, by step or by the project it named', () => {
    const { sessions } = nowSessions({
      ...base,
      scope: 'website',
      progress: [report({}), report({ sessionId: 'cse_c', planItemId: null, project: 'website' })],
      going: [run({ planItemId: 's2', runId: 'r5' })],
    });
    expect(sessions.map((s) => s.key).sort()).toEqual(['guess:r5', 'report:cse_c:']);
  });

  it('leaves out reports that finished, went silent for hours or whose run ended, and keeps the last finished', () => {
    const { sessions, finished } = nowSessions({
      ...base,
      progress: [
        report({ state: 'done', action: 'Committed abc1234', updatedAt: ago(30) }),
        report({ sessionId: 'cse_old', updatedAt: ago(200) }),
        report({ sessionId: 'cse_ended', planRunId: 'r7', planItemId: 's3' }),
      ],
      endedRuns: new Set(['r7']),
    });
    expect(sessions).toEqual([]);
    expect(finished).toMatchObject({ state: 'done', action: 'Committed abc1234' });
  });
});

describe('isStale', () => {
  it('marks a working session after twenty minutes without a report, never one waiting on you', () => {
    expect(isStale({ at: ago(19), state: 'working' }, NOW)).toBe(false);
    expect(isStale({ at: ago(21), state: 'working' }, NOW)).toBe(true);
    expect(isStale({ at: ago(60), state: 'waiting' }, NOW)).toBe(false);
    expect(isStale({ at: ago(60), state: 'working' }, 0)).toBe(false);
  });
});

describe('withoutTitle', () => {
  it('drops a commit subject that only repeats the step title', () => {
    expect(withoutTitle('Committed 9b02d17: Add an RSS feed', 'Add an RSS feed')).toBe('Committed 9b02d17');
    expect(withoutTitle('Pushed: Build the feed', 'Add an RSS feed')).toBe('Pushed: Build the feed');
    expect(withoutTitle('Add an RSS feed', 'Add an RSS feed')).toBe('Add an RSS feed');
  });
});
