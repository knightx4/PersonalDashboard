import { describe, expect, it } from 'vitest';
import { chooseNightSteps, type NightRun, type NightStep } from '@/lib/goals/overnight-choice';
import { RUN_QUIET_MS } from '@/lib/goals/shaping';

const NOW = Date.parse('2026-09-25T03:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function step(id: string, goalId: string, dueOn: string | null = null): NightStep {
  return { id, title: `Step ${id}`, goalId, goalTitle: `Goal ${goalId}`, dueOn };
}

function run(
  goalId: string,
  stepId: string | null,
  status: NightRun['status'],
  hoursAgo: number,
): NightRun {
  return { goalId, stepId, status, createdAt: new Date(NOW - hoursAgo * HOUR).toISOString() };
}

const ids = (steps: readonly NightStep[]) => steps.map((s) => s.id);

describe('chooseNightSteps', () => {
  it('orders a fixture by due date, then by the goal longest without progress, and skips what it should', () => {
    const steps = [
      step('fresh', 'g-fresh'),
      step('stale', 'g-stale'),
      step('never', 'g-never'),
      step('due-late', 'g-due-late', '2026-10-10'),
      step('due-soon', 'g-due-soon', '2026-09-26'),
      step('busy', 'g-busy', '2026-09-25'),
      step('flaky', 'g-flaky', '2026-09-25'),
      step('second', 'g-stale'),
    ];
    const runs = [
      run('g-busy', null, 'started', 1),
      run('g-flaky', 'flaky', 'failed', 30),
      run('g-flaky', 'flaky', 'failed', 5),
    ];
    const lastProgressAt = new Map<string, string | null>([
      ['g-fresh', '2026-09-24T12:00:00.000Z'],
      ['g-stale', '2026-09-01T12:00:00.000Z'],
    ]);

    const choice = chooseNightSteps({ steps, runs, lastProgressAt, now: NOW });

    expect(ids(choice.chosen)).toEqual(['due-soon', 'due-late', 'never', 'stale', 'fresh']);
    expect(choice.skipped.map((s) => [s.step.id, s.reason])).toEqual([
      ['busy', 'goal_running'],
      ['flaky', 'failed_twice'],
      ['second', 'goal_chosen'],
    ]);
  });

  it('keeps a step whose last run failed but the one before it finished', () => {
    const runs = [
      run('g', 's', 'done', 30),
      run('g', 's', 'failed', 20),
      run('g', 's', 'failed', 3),
    ];
    expect(
      ids(
        chooseNightSteps({
          steps: [step('s', 'g')],
          runs: runs.slice(0, 2),
          lastProgressAt: new Map(),
          now: NOW,
        }).chosen,
      ),
    ).toEqual(['s']);
    expect(
      chooseNightSteps({ steps: [step('s', 'g')], runs, lastProgressAt: new Map(), now: NOW })
        .skipped[0]?.reason,
    ).toBe('failed_twice');
  });

  it('counts a run that never reported back as a failure, and not as a run going', () => {
    const silent = (hoursAgo: number) => run('g', 's', 'started', RUN_QUIET_MS / HOUR + hoursAgo);
    const choice = chooseNightSteps({
      steps: [step('s', 'g')],
      runs: [silent(1), silent(10)],
      lastProgressAt: new Map(),
      now: NOW,
    });
    expect(choice.skipped).toEqual([{ step: step('s', 'g'), reason: 'failed_twice' }]);
  });

  it('keeps page order among steps that tie', () => {
    const steps = [step('a', 'g1'), step('b', 'g2'), step('c', 'g3')];
    expect(
      ids(chooseNightSteps({ steps, runs: [], lastProgressAt: new Map(), now: NOW }).chosen),
    ).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing when nothing is ready', () => {
    expect(chooseNightSteps({ steps: [], runs: [], lastProgressAt: new Map(), now: NOW })).toEqual({
      chosen: [],
      skipped: [],
    });
  });
});
