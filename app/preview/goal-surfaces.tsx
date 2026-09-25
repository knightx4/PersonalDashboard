import { StepTree } from '@/app/goals/[goalId]/step-tree';
import { attachDependencies, type DependencyRow } from '@/lib/goals/dependencies';
import { buildForest, type Step } from '@/lib/goals/steps';
import type { GoalMap } from '@/lib/goals/steps-store';

/**
 * A goal's page of steps, drawn from fixtures for the gallery (plan #982).
 *
 * Beside the dev plan's surfaces in plan-surfaces.tsx, so the two can be
 * photographed together: the goal page draws its steps with the plan's
 * shared row. The tree holds a step of each kind -- yours, Claude's, a
 * question and a rhythm -- and the states a goal step can be in: blocked on
 * you, waiting on another step, a proposal, a Claude result to read, done
 * and dropped. No clock anywhere in it, so two shots only differ when the
 * page does.
 */

function step(id: string, parentId: string, extra: Partial<Step> & { title: string }): Step {
  return {
    id,
    parentId,
    kind: 'mine',
    status: 'open',
    detail: null,
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

const GOAL = 'goal-debt';

const steps: Step[] = [
  step('list', GOAL, {
    title: 'List every balance',
    detail: 'Every card, loan and overdraft, with what is owed and the rate.',
    acceptance: 'Each debt has a balance and a rate written down.',
    status: 'done',
    position: 10,
  }),
  step('rates', GOAL, {
    title: 'Get the rates lowered',
    detail: 'Call each lender and ask for a lower rate.',
    position: 20,
  }),
  step('script', 'rates', {
    title: 'Draft what to say on the call',
    kind: 'claude',
    result: 'A short script: the balance, how long you have been a customer, and the rate a competitor offers.',
    position: 10,
  }),
  step('call', 'rates', {
    title: 'Call the card company',
    status: 'blocked',
    blockKind: 'outside',
    blockAsk: 'The account number from the last statement.',
    dueOn: '2026-10-03',
    position: 20,
  }),
  step('which', 'rates', {
    title: 'Which card goes first?',
    kind: 'decision',
    detail:
      'A — The highest rate. Saves the most interest.\nB — The smallest balance. Closes one soonest.\nRecommend A.',
    position: 30,
  }),
  step('transfer', GOAL, {
    title: 'Move the balance to a 0% card',
    detail: 'Only once the rates are known.',
    position: 30,
  }),
  step('review', GOAL, {
    title: 'Check the budget every week',
    kind: 'rhythm',
    rhythmCount: 1,
    rhythmPeriod: 'week',
    position: 40,
  }),
  step('consolidate', GOAL, {
    title: 'Look into a consolidation loan',
    kind: 'claude',
    status: 'proposed',
    position: 50,
  }),
  step('overdraft', GOAL, {
    title: 'Close the overdraft',
    status: 'dropped',
    position: 60,
  }),
];

const dependencies: DependencyRow[] = [{ id: 'dep-1', itemId: 'transfer', dependsOnId: 'rates' }];

const forest = buildForest([GOAL], steps);
attachDependencies(forest.byGoal, forest.nodes, dependencies);

const map: GoalMap = {
  goal: {
    id: GOAL,
    areaId: 'money',
    title: 'Pay off the credit cards',
    acceptance: 'Every card at a zero balance.',
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
  rhythms: {
    review: {
      current: {
        id: 'period-now',
        itemId: 'review',
        startsOn: '2026-09-21',
        endsOn: '2026-09-28',
        target: 1,
        count: 0,
        kept: null,
        closedAt: null,
      },
      past: [
        {
          id: 'period-1',
          itemId: 'review',
          startsOn: '2026-09-07',
          endsOn: '2026-09-14',
          target: 1,
          count: 1,
          kept: true,
          closedAt: '2026-09-14T00:00:00Z',
        },
        {
          id: 'period-2',
          itemId: 'review',
          startsOn: '2026-09-14',
          endsOn: '2026-09-21',
          target: 1,
          count: 0,
          kept: false,
          closedAt: '2026-09-21T00:00:00Z',
        },
      ],
      missed: 1,
    },
  },
  information: {},
  threads: {
    call: [
      {
        id: 'comment-1',
        author: 'me',
        body: 'The statement is in the drawer at home.',
        createdAt: '2026-09-20T09:00:00Z',
      },
    ],
  },
};

/** The steps as a list, every step unfolded: the page as it opens. */
export function GoalTreeSurface() {
  return <StepTree map={map} todoOn={false} />;
}

/** The same steps with every row opened: the panel behind each row. */
export function GoalOpenedSurface() {
  return <StepTree map={map} todoOn={false} opened />;
}
