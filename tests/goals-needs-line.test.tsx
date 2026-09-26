/**
 * A goal step waiting on you says what for, on its row (note 5aa7216c), as
 * the dev plan's Needs line does: the block's ask, or the read a finished
 * Claude step is waiting on.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildForest, type Step } from '@/lib/goals/steps';
import { REVIEW_ASK } from '@/lib/goals/plan-rows';
import type { GoalMap } from '@/lib/goals/steps-store';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/goals/goal-debt',
  useSearchParams: () => new URLSearchParams(),
}));

const { StepTree } = await import('@/app/goals/[goalId]/step-tree');

const GOAL = 'goal-debt';

function step(id: string, extra: Partial<Step> & { title: string }): Step {
  return {
    id,
    parentId: GOAL,
    kind: 'mine',
    status: 'open',
    detail: 'The detail line',
    acceptance: null,
    resolution: null,
    dismissedAt: null,
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

function render(steps: Step[]) {
  const forest = buildForest([GOAL], steps);
  const map: GoalMap = {
    goal: {
      id: GOAL,
      areaId: 'money',
      title: 'Pay off the student loans',
      acceptance: null,
      fog: null,
      status: 'open',
      position: 10,
      unit: null,
      target: null,
    },
    areaName: 'Money',
    steps: forest.byGoal.get(GOAL) ?? [],
    linked: [],
    otherGoals: [],
    linksOf: {},
    rhythms: {},
    information: {},
    answers: {},
    threads: {},
  };
  return renderToStaticMarkup(<StepTree map={map} todoOn={false} />);
}

describe('the Needs line on a goal step', () => {
  it("says a blocked step's ask in place of its detail", () => {
    const html = render([
      step('a', {
        title: 'Send the form',
        status: 'blocked',
        blockKind: 'outside',
        blockAsk: 'The bank letter from March',
      }),
    ]);
    expect(html).toContain('Needs: </span>The bank letter from March');
    expect(html).not.toContain('The detail line');
  });

  it('says what a finished Claude step waits on', () => {
    const html = render([
      step('a', { title: 'Draft the letter', kind: 'claude', status: 'done', result: 'Drafted' }),
    ]);
    expect(html).toContain(`Needs: </span>${REVIEW_ASK}`);
  });

  it('leaves an open step with its detail', () => {
    const html = render([step('a', { title: 'List balances' })]);
    expect(html).not.toContain('Needs: ');
    expect(html).toContain('The detail line');
  });
});
