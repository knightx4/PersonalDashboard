import { describe, expect, it } from 'vitest';
import {
  approvalLine,
  awaitsAnswer,
  changesLine,
  countAside,
  countOpenQuestions,
  countProposed,
  goalRunText,
  RUN_QUIET_MS,
  runInFlight,
  runChanges,
  runLine,
  type GoalRun,
  type RunHistoryRow,
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

  it('counts what a run changed from its history rows', () => {
    const row = (extra: Partial<RunHistoryRow>): RunHistoryRow => ({
      table_name: 'items',
      action: 'insert',
      row_id: 'x',
      old_values: null,
      new_values: null,
      ...extra,
    });
    const rows: RunHistoryRow[] = [
      row({ new_values: { level: 'step', kind: 'claude', status: 'proposed' } }),
      row({ new_values: { level: 'step', kind: 'mine', status: 'open' } }),
      row({ new_values: { level: 'step', kind: 'decision', status: 'open' } }),
      row({ new_values: { level: 'goal', kind: null, status: 'open' } }),
      row({ action: 'update', old_values: { status: 'open' }, new_values: { status: 'done' } }),
      row({ action: 'update', old_values: { title: 'a' }, new_values: { title: 'b' } }),
      row({ table_name: 'records', row_id: 'r1', new_values: { data: {} } }),
      row({ table_name: 'records', action: 'update', row_id: 'r1', old_values: {}, new_values: {} }),
      row({ table_name: 'records', action: 'update', row_id: 'r2', old_values: {}, new_values: {} }),
      row({ table_name: 'records', action: 'archive', row_id: 'r3', old_values: {}, new_values: {} }),
    ];
    const changes = runChanges(rows);
    expect(changes).toEqual({ stepsAdded: 2, questionsAsked: 1, formsFilled: 2, stepsDone: 1 });
    expect(changesLine(changes)).toBe(
      'What it changed: 2 steps added, 1 question asked, 2 forms filled and 1 step done.',
    );
    expect(changesLine({ stepsAdded: 0, questionsAsked: 3, formsFilled: 0, stepsDone: 0 })).toBe(
      'What it changed: 3 questions asked.',
    );
    expect(changesLine(runChanges([]))).toBe('It left the steps and forms as they were.');
    expect(changesLine(null)).toBeNull();
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
