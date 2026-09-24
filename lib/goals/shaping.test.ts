import { describe, expect, it } from 'vitest';
import {
  approvalLine,
  countOpenQuestions,
  countProposed,
  goalRunText,
  RUN_QUIET_MS,
  runInFlight,
  runLine,
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
    createdAt: '2026-09-24T11:00:00Z',
    endedAt: null,
    summary: null,
    error: null,
    ...extra,
  };
}

const when = (iso: string) => `at ${iso.slice(11, 16)}`;

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

describe('runs', () => {
  it('takes a started run to be going for two hours, then not', () => {
    expect(runInFlight(null, NOW)).toBe(false);
    expect(runInFlight(run(), NOW)).toBe(true);
    expect(runInFlight(run({ createdAt: new Date(NOW - RUN_QUIET_MS).toISOString() }), NOW)).toBe(false);
    expect(runInFlight(run({ status: 'done' }), NOW)).toBe(false);
  });

  it('says what the last run did in one line', () => {
    expect(runLine(null, NOW, when)).toBeNull();
    expect(runLine(run(), NOW, when)).toBe('Claude is working on this, started at 11:00.');
    expect(
      runLine(run({ status: 'done', endedAt: '2026-09-24T11:20:00Z', summary: 'Proposed 5 steps.\nMore.' }), NOW, when),
    ).toBe('Claude worked on this at 11:20: Proposed 5 steps.');
    expect(runLine(run({ status: 'failed', error: 'Anthropic answered 401.' }), NOW, when)).toBe(
      'The last run did not start or did not finish: Anthropic answered 401.',
    );
    expect(runLine(run({ createdAt: '2026-09-24T08:00:00Z' }), NOW, when)).toBe(
      'A run started at 08:00 and never reported back.',
    );
  });

  it('briefs the routine with the goal, the account and the run row', () => {
    const text = goalRunText({ goalId: 'g-1', goalTitle: 'Get fit', userId: 'u-1', runId: 'r-1' });
    expect(text).toContain('"Get fit" (goals.items id g-1)');
    expect(text).toContain('user_id u-1');
    expect(text).toContain('goals.runs id r-1');
    expect(text).toContain('.claude/skills/goals/SKILL.md');
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
});
