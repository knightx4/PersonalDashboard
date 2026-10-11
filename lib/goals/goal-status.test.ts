import { describe, expect, it } from 'vitest';
import { claudeLine, goalStatus, statusLine, STATUS_STEPS_SHOWN } from './goal-status';
import { buildForest, type Step } from './steps';
import type { Goal } from './tree';

const GOAL: Goal = {
  id: 'g',
  areaId: 'area',
  title: 'Land a finance role',
  acceptance: null,
  fog: null,
  status: 'open',
  position: 10,
  unit: null,
  target: null,
};

function step(id: string, extra: Partial<Step> = {}): Step {
  return {
    id,
    parentId: 'g',
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
    ...extra,
  };
}

function status(steps: Step[], goal: Goal = GOAL) {
  const { byGoal } = buildForest([goal.id], steps);
  return goalStatus(goal, 'Career', byGoal.get(goal.id) ?? [], '2026-09-26');
}

describe('goalStatus', () => {
  it('lists what is yours in the order the home uses: questions, approvals, results, then steps', () => {
    const view = status([
      step('mine-1', { title: 'Update the resume' }),
      step('result', { kind: 'claude', status: 'done', result: 'The breakdown', title: 'Split by role family' }),
      step('question', { kind: 'decision', title: 'Which lane first?' }),
      step('proposed', { status: 'proposed', title: 'Email the recruiter' }),
    ]);
    expect(view.yourMove.map((row) => [row.kind, row.title, row.href])).toEqual([
      ['question', 'Which lane first?', '?tab=steps#step-question'],
      ['approve', '1 proposed step', '?tab=steps#step-proposed'],
      ['read', 'Split by role family', '?tab=steps#step-result'],
      ['do', 'Update the resume', '?tab=steps#step-mine-1'],
    ]);
  });

  it('shows a few of your steps and counts the rest', () => {
    const steps = Array.from({ length: STATUS_STEPS_SHOWN + 2 }, (_, i) => step(`m${i}`, { position: i }));
    const view = status(steps);
    expect(view.yourMove.filter((row) => row.kind === 'do')).toHaveLength(STATUS_STEPS_SHOWN);
    expect(view.moreSteps).toBe(2);
  });

  it('puts a due date on a step of yours, and none on one already past', () => {
    const view = status([
      step('soon', { dueOn: '2026-10-03', title: 'Soon' }),
      step('late', { dueOn: '2026-09-01', title: 'Late' }),
    ]);
    const labels = Object.fromEntries(view.yourMove.map((row) => [row.id, row.label]));
    expect(labels.late).toBe('Do');
    expect(labels.soon).toBe('Do by 3 Oct');
  });

  it('asks for approval of a goal Dash proposed, and counts its Dash steps as held', () => {
    const view = status([step('c', { kind: 'claude' })], { ...GOAL, status: 'proposed' });
    expect(view.yourMove).toEqual([
      expect.objectContaining({ kind: 'approve', href: '#claude-heading' }),
    ]);
    expect(view.claudeHeld).toBe(1);
  });

  it('counts the Dash steps the next run will work, and says nothing is waiting when nothing is', () => {
    const view = status([step('c1', { kind: 'claude' }), step('c2', { kind: 'claude' })]);
    expect(view.yourMove).toEqual([]);
    expect(claudeLine(view)).toBe('Dash will work 2 steps on its next run.');
  });

  it('puts the flags passed in first, pointing at the flag', () => {
    const { byGoal } = buildForest(['g'], [step('m')]);
    const view = goalStatus(GOAL, 'Career', byGoal.get('g') ?? [], '2026-09-26', [
      { kind: 'flag', id: 'f1', title: 'The due date moved', goalId: 'g', goalTitle: GOAL.title },
    ]);
    expect(view.yourMove[0]).toMatchObject({ kind: 'flag', href: '#flag-f1' });
  });
});

describe('claudeLine', () => {
  it('is null when Dash has nothing lined up', () => {
    expect(claudeLine({ claudeReady: 0, claudeHeld: 0 })).toBeNull();
  });

  it('names held steps as waiting on approval', () => {
    expect(claudeLine({ claudeReady: 1, claudeHeld: 1 })).toBe(
      'Dash will work 1 step on its next run. 1 Dash step waits for your approval.',
    );
  });
});

describe('statusLine', () => {
  const row = { id: 'x', kind: 'do' as const, label: 'Do', title: 'x', href: '#x' };

  it('counts what is on you, what Dash is on, the due date and the last progress', () => {
    expect(
      statusLine(
        { yourMove: [row, row], moreSteps: 1, claudeReady: 4 },
        { running: 1, dueOn: '2026-10-31', lastProgressOn: '2026-10-03' },
      ),
    ).toBe('3 on you · Dash on 1 · due 31 Oct · last progress 3 Oct');
  });

  it('says how many steps are ready for Dash when no run is going, and when nothing is on you', () => {
    expect(statusLine({ yourMove: [], moreSteps: 0, claudeReady: 2 })).toBe(
      'Nothing on you · 2 steps ready for Dash',
    );
    expect(statusLine({ yourMove: [], moreSteps: 0, claudeReady: 0 })).toBe('Nothing on you');
  });
});
