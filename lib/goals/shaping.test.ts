import { describe, expect, it } from 'vitest';
import {
  approvalLine,
  areaRunText,
  areaRunView,
  awaitsAnswer,
  countAside,
  countOpenQuestions,
  countProposed,
  goalRunText,
  quietRunError,
  RUN_QUIET_MS,
  runInFlight,
  runProgress,
  type GoalRun,
} from './shaping';
import type { StepNode } from './steps';

function node(id: string, extra: Partial<StepNode> = {}): StepNode {
  return {
    id,
    parentId: 'goal',
    kind: 'mine',
    status: 'open',
    title: id,
    detail: null,
    acceptance: null,
    resolution: null,
    dueOn: null,
    position: 10,
    rhythmCount: null,
    rhythmPeriod: null,
    onTodo: false,
    result: null,
    resultUrl: null,
    reviewedAt: null,
    children: [],
    ...extra,
  };
}

const NOW = Date.parse('2026-09-24T12:00:00Z');

function run(extra: Partial<GoalRun> = {}): GoalRun {
  return {
    id: 'run',
    status: 'started',
    createdAt: '2026-09-24T11:30:00Z',
    endedAt: null,
    summary: null,
    error: null,
    ...extra,
  };
}

describe('counting what waits on you', () => {
  it('counts proposed steps at every depth, even under an open one', () => {
    const tree = [
      node('a', { status: 'proposed', children: [node('a1', { status: 'proposed' })] }),
      node('b', { children: [node('b1', { status: 'proposed' }), node('b2')] }),
    ];
    expect(countProposed(tree)).toBe(3);
  });

  it('counts only open questions with no answer', () => {
    const tree = [
      node('q1', { kind: 'decision' }),
      node('q2', { kind: 'decision', status: 'done', resolution: 'Strength' }),
      node('s', { children: [node('q3', { kind: 'decision' })] }),
      node('q4', { kind: 'decision', status: 'proposed' }),
    ];
    expect(countOpenQuestions(tree)).toBe(2);
  });
});

describe('questions put aside (plan #956)', () => {
  it('leaves a question put aside out of what waits on you, and counts it as aside', () => {
    const aside = node('q1', { kind: 'decision', dismissedAt: '2026-09-24T10:00:00Z' });
    const live = node('q2', { kind: 'decision' });
    const answered = node('q3', { kind: 'decision', status: 'done', resolution: 'A — Avalanche' });
    const tree = [node('s', { children: [aside, live] }), answered];

    expect(awaitsAnswer(aside)).toBe(false);
    expect(awaitsAnswer(live)).toBe(true);
    expect(awaitsAnswer(answered)).toBe(false);
    expect(countOpenQuestions(tree)).toBe(1);
    expect(countAside(tree)).toBe(1);
  });
});

describe('runs', () => {
  it('takes a started run to be going until it has been quiet for 45 minutes', () => {
    expect(RUN_QUIET_MS).toBe(45 * 60 * 1000);
    expect(runInFlight(null, NOW)).toBe(false);
    expect(runInFlight(run(), NOW)).toBe(true);
    expect(runInFlight(run({ createdAt: new Date(NOW - RUN_QUIET_MS).toISOString() }), NOW)).toBe(false);
    expect(runInFlight(run({ status: 'done' }), NOW)).toBe(false);
  });

  it('measures quiet from the last report, so a long run that keeps reporting stays going', () => {
    const long = run({ createdAt: '2026-09-24T09:00:00Z', lastSeenAt: '2026-09-24T11:50:00Z' });
    expect(runInFlight(long, NOW)).toBe(true);
    expect(runInFlight({ ...long, lastSeenAt: '2026-09-24T11:10:00Z' }, NOW)).toBe(false);
  });

  it('says which step a running run is on and when it last reported', () => {
    const on = run({ lastSeenAt: '2026-09-24T11:57:00Z', nowOn: 'Draft the letter to Edfinancial' });
    expect(runProgress(on, NOW)).toBe('on Draft the letter to Edfinancial, 3 minutes ago');
    expect(runProgress({ ...on, lastSeenAt: '2026-09-24T11:59:30Z' }, NOW)).toBe(
      'on Draft the letter to Edfinancial, just now',
    );
    expect(runProgress({ ...on, lastSeenAt: '2026-09-24T11:59:00Z' }, NOW)).toBe(
      'on Draft the letter to Edfinancial, 1 minute ago',
    );
    expect(runProgress(run({ lastSeenAt: '2026-09-24T11:57:00Z' }), NOW)).toBe('last reported 3 minutes ago');
    expect(runProgress(run(), NOW)).toBe('started 30 minutes ago');
    expect(runProgress(run({ status: 'done' }), NOW)).toBeNull();
  });

  it('closes a quiet run with where it stopped', () => {
    expect(quietRunError({ nowOn: 'Draft the letter' })).toBe(
      'The session stopped reporting while on Draft the letter, and nothing was heard for 45 minutes.',
    );
    expect(quietRunError({ nowOn: null })).toBe(
      'The session never reported progress, and nothing was heard for 45 minutes.',
    );
  });

  it('briefs the routine with the goal, the account and the run row', () => {
    const text = goalRunText({ goalId: 'g-1', goalTitle: 'Get fit', userId: 'u-1', runId: 'r-1' });
    expect(text).toContain('"Get fit" (goals.items id g-1)');
    expect(text).toContain('user_id u-1');
    expect(text).toContain('goals.runs id r-1');
    expect(text).toContain('.claude/skills/goals/SKILL.md');
    expect(text).toContain('map the whole path');
  });
});

describe('planning an area', () => {
  it('briefs the routine with the area, its note, its goals and the run row', () => {
    const text = areaRunText({
      areaId: 'a-1',
      areaName: 'The city',
      note: 'Meet the people working on transit.',
      goals: [{ title: 'Go to a community board meeting', status: 'open' }],
      userId: 'u-1',
      runId: 'r-1',
    });
    expect(text).toContain('"The city" (goals.areas id a-1)');
    expect(text).toContain('Meet the people working on transit.');
    expect(text).toContain('- Go to a community board meeting (open)');
    expect(text).toContain('"Planning an area"');
    expect(text).toContain('goals.runs id r-1');
    expect(text).toContain('user_id u-1');
  });

  it('says so when the area has no note and no goals', () => {
    const text = areaRunText({ areaId: 'a', areaName: 'Health', note: '  ', goals: [], userId: 'u', runId: 'r' });
    expect(text).toContain('has not written what they want from it');
    expect(text).toContain('It has no goals yet.');
  });

  it('reads the latest run as going, failed, gone quiet or finished', () => {
    expect(areaRunView(run({ lastSeenAt: '2026-09-24T11:57:00Z', nowOn: 'Reading the note' }), NOW)).toMatchObject({
      running: 'on Reading the note, 3 minutes ago',
      error: null,
    });
    expect(areaRunView(run({ status: 'failed', error: 'Token rejected' }), NOW)).toMatchObject({
      running: null,
      error: 'Token rejected',
    });
    expect(
      areaRunView(run({ createdAt: new Date(NOW - RUN_QUIET_MS).toISOString() }), NOW).error,
    ).toContain('never reported progress');
    expect(areaRunView(run({ status: 'done', summary: 'Proposed four goals.\nMore.' }), NOW)).toMatchObject({
      running: null,
      error: null,
      summary: 'Proposed four goals.',
    });
  });
});

describe('approvalLine', () => {
  const base = { goalStatus: 'open' as const, approvedAt: null, proposed: 0, questions: 0 };

  it('offers to approve a goal Claude proposed', () => {
    const line = approvalLine({ ...base, goalStatus: 'proposed', proposed: 2 });
    expect(line.approve).toBe('Approve goal');
    expect(line.text).toMatch(/^Claude proposed this goal and 2 steps under it\./);
  });

  it('offers to approve a breakdown, and names the questions waiting', () => {
    const line = approvalLine({ ...base, proposed: 4, questions: 1 });
    expect(line.approve).toBe('Approve breakdown');
    expect(line.text).toContain('Claude proposed 4 steps.');
    expect(line.text).toContain('One question for you is in the steps below.');
  });

  it('lets you approve a goal with nothing proposed yet', () => {
    expect(approvalLine(base).approve).toBe('Approve goal');
  });

  it('offers no button once approved with nothing waiting, and one when more is proposed', () => {
    expect(approvalLine({ ...base, approvedAt: '2026-09-20T00:00:00Z' }).approve).toBeNull();
    expect(approvalLine({ ...base, approvedAt: '2026-09-20T00:00:00Z', proposed: 1 }).approve).toBe(
      'Approve it',
    );
  });

  it('says nothing about approval once approved with nothing waiting but the questions', () => {
    const approvedAt = '2026-09-20T00:00:00Z';
    expect(approvalLine({ ...base, approvedAt }).text).toBe('');
    expect(approvalLine({ ...base, approvedAt, questions: 2 }).text).toBe(
      '2 questions for you are in the steps below.',
    );
  });
});
