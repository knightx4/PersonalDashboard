import { describe, expect, it } from 'vitest';
import { DAILY_GAP_MS, dailyRunText, ranRecently, readyClaudeSteps } from './daily-run';
import { buildForest, markStartDates, type Step } from './steps';
import type { Goal } from './tree';

function goal(id: string, extra: Partial<Goal> = {}): Goal {
  return {
    id,
    areaId: 'area',
    title: `Goal ${id}`,
    acceptance: null,
    fog: null,
    status: 'open',
    position: 10,
    unit: null,
    target: null,
    ...extra,
  };
}

function step(id: string, parentId: string, extra: Partial<Step> = {}): Step {
  return {
    id,
    parentId,
    kind: 'claude',
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
    ...extra,
  };
}

function ready(goals: Goal[], steps: Step[], today?: string) {
  const { byGoal } = buildForest(
    goals.map((g) => g.id),
    steps,
  );
  if (today) markStartDates(byGoal, today);
  return readyClaudeSteps(goals, byGoal).map((s) => s.id);
}

describe('steps for later', () => {
  const steps = [
    step('now', 'a'),
    step('november', 'a', { startsOn: '2026-11-01' }),
    step('stage', 'a', { kind: 'mine', startsOn: '2026-11-01' }),
    step('under', 'stage'),
    step('started', 'a', { startsOn: '2026-09-01' }),
  ];

  it('leaves a step, and what is under it, until its start date', () => {
    expect(ready([goal('a')], steps, '2026-09-26')).toEqual(['now', 'started']);
  });

  it('works them from the start date on', () => {
    expect(ready([goal('a')], steps, '2026-11-01')).toEqual(['now', 'november', 'under', 'started']);
  });
});

describe('readyClaudeSteps', () => {
  it('takes open Claude steps with nothing produced yet, in page order', () => {
    expect(
      ready(
        [goal('a'), goal('b')],
        [
          step('a1', 'a'),
          step('mine', 'a', { kind: 'mine' }),
          step('ask', 'a', { kind: 'decision' }),
          step('b1', 'b'),
        ],
      ),
    ).toEqual(['a1', 'b1']);
  });

  it('leaves out a step already worked, closed, proposed or waiting on open sub-steps', () => {
    expect(
      ready(
        [goal('g')],
        [
          step('worked', 'g', { result: 'A note' }),
          step('linked', 'g', { resultUrl: 'https://example.test' }),
          step('done', 'g', { status: 'done' }),
          step('proposed', 'g', { status: 'proposed' }),
          step('parent', 'g'),
          step('child', 'parent'),
          step('under-done', 'done'),
        ],
      ),
    ).toEqual(['child']);
  });

  it('works nothing under a goal that is proposed, done or dropped', () => {
    expect(
      ready(
        [goal('p', { status: 'proposed' }), goal('d', { status: 'done' }), goal('x', { status: 'dropped' })],
        [step('p1', 'p'), step('d1', 'd'), step('x1', 'x')],
      ),
    ).toEqual([]);
  });
});

describe('ranRecently', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');
  it('refuses a second morning run within the gap and allows one after it', () => {
    expect(ranRecently(null, now)).toBe(false);
    expect(ranRecently('2026-09-24T11:00:00Z', now)).toBe(true);
    expect(ranRecently(new Date(now - DAILY_GAP_MS - 1).toISOString(), now)).toBe(false);
    // Yesterday's cron, at the same hour.
    expect(ranRecently('2026-09-23T12:00:00Z', now)).toBe(false);
  });
});

describe('dailyRunText', () => {
  it('names the account, the run row and every step to work', () => {
    const text = dailyRunText({
      userId: 'user-1',
      runId: 'run-1',
      steps: [{ id: 's1', title: 'Compare three gyms', goalId: 'g', goalTitle: 'Get fit' }],
    });
    expect(text).toContain('user_id user-1');
    expect(text).toContain('goals.runs id run-1');
    expect(text).toContain('"Compare three gyms" (goals.items id s1), under the goal "Get fit"');
    expect(text).toContain('The morning run');
  });
});
