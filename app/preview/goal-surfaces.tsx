import { GoalRhythms } from '@/app/goals/[goalId]/goal-found';
import { StepPage } from '@/app/goals/[goalId]/step-page';
import { StepTree } from '@/app/goals/[goalId]/step-tree';
import { rhythmSteps } from '@/lib/goals/goal-page';
import { attachDependencies, type DependencyRow } from '@/lib/goals/dependencies';
import { buildForest, type Step } from '@/lib/goals/steps';
import type { GoalMap } from '@/lib/goals/steps-store';
import type { Collection } from '@/lib/goals/collections-store';

/**
 * A goal's steps, drawn from fixtures for the gallery (plans #982, #1078).
 *
 * The goal is in three stages: Know what you owe, open under Now with an
 * information step of yours ready; Get the rates lowered, open because it
 * holds a question and a draft of Dash's for the call; and Move the balance,
 * waiting on the second, as one line under Other stages. The tree holds a
 * step of each kind (yours, Dash's, a question, a rhythm and an information
 * step with a form) and the states a goal step can be in: blocked on you,
 * waiting on another step, a proposal, done and dropped. A step from another
 * goal is linked in, and one step waits on a step in a goal that is not on
 * the page (plan #983). No clock anywhere in it, so two shots only differ
 * when the page does.
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
  step('owe', GOAL, {
    title: 'Know what you owe',
    acceptance: 'Every debt and every income written down.',
    position: 5,
  }),
  step('list', 'owe', {
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
    status: 'done',
    preparesId: 'call',
    result:
      'A short script for the call. Give the balance, say you have been a customer for six years, and name the 19% a competitor offers.\n\n1. Ask for the retention team.\n2. Ask them to match 19% for twelve months.',
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
  step('move', GOAL, {
    title: 'Move the balance',
    position: 30,
  }),
  step('transfer', 'move', {
    title: 'Move the balance to a 0% card',
    detail: 'Only once the rates are known.',
    position: 10,
  }),
  step('fees', 'move', {
    title: 'Compare the transfer fees',
    kind: 'claude',
    position: 20,
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
  step('income', 'owe', {
    title: 'Write down what comes in each month',
    detail: 'Pay and anything else that arrives regularly.',
    collectionId: 'col-income',
    position: 55,
  }),
  step('overdraft', GOAL, {
    title: 'Close the overdraft',
    status: 'dropped',
    position: 60,
  }),
];

/** Another goal: one step linked into this one, one this goal waits on. */
const OTHER = 'goal-savings';

const otherSteps: Step[] = [
  step('fund', OTHER, {
    title: 'Keep a month of spending in savings',
    acceptance: 'The savings account holds one month of spending.',
    position: 10,
  }),
  step('payday', OTHER, {
    title: 'Move payday to the first of the month',
    position: 20,
  }),
];

const dependencies: DependencyRow[] = [
  { id: 'dep-1', itemId: 'move', dependsOnId: 'rates' },
  { id: 'dep-2', itemId: 'review', dependsOnId: 'payday' },
];

const forest = buildForest([GOAL, OTHER], [...steps, ...otherSteps]);
attachDependencies(forest.byGoal, forest.nodes, dependencies);

const income: Collection = {
  id: 'col-income',
  name: 'Income',
  shape: 'one',
  version: 1,
  goalIds: [GOAL],
  fields: [
    { key: 'pay', label: 'Monthly pay', type: 'money' },
    { key: 'other', label: 'Other income', type: 'text' },
  ],
};

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
  linked: [
    {
      linkId: 'link-1',
      fromGoal: { id: OTHER, title: 'Build an emergency fund' },
      step: forest.nodes.get('fund')!,
    },
  ],
  otherGoals: [{ id: OTHER, title: 'Build an emergency fund' }],
  linksOf: { fund: [{ linkId: 'link-1', goalId: GOAL, title: 'Pay off the credit cards' }] },
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
  information: {
    'col-income': {
      collection: income,
      records: [
        {
          id: 'rec-1',
          collectionId: 'col-income',
          data: { pay: 2400, other: null },
          version: 1,
          position: 10,
          source: 'gmail',
          sourceRef: null,
          draft: true,
          asOf: null,
          updatedAt: '2026-09-20T09:00:00Z',
        },
      ],
    },
  },
  answers: {},
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

/** The steps as the page opens: Now, the rhythm under it, and the other stage folded. */
export function GoalTreeSurface() {
  return (
    <StepTree
      map={map}
      todoOn={false}
      belowNow={<GoalRhythms steps={rhythmSteps(map.steps)} records={map.rhythms} />}
    />
  );
}

/** The same steps with every row opened: the panel behind each row. */
export function GoalOpenedSurface() {
  return <StepTree map={map} todoOn={false} opened />;
}

/**
 * A step on its own page (plan #1620): Get the rates lowered, opened, with
 * Dash's draft for the call, a step blocked on you with a comment, and a
 * question beneath it.
 */
export function GoalStepSurface() {
  return <StepPage map={map} stepId="rates" todoOn={false} />;
}

/** A sub-step on its own page: Call the card company, under Get the rates lowered. */
export function GoalSubStepSurface() {
  return <StepPage map={map} stepId="call" todoOn={false} />;
}

/**
 * The same goal with some of its steps changed, for the moments on a step's
 * own page (app/preview/goal-moment-demos.tsx): a fresh forest each time, so
 * the fixtures above are never touched.
 */
export function goalMapWith(changes: Record<string, Partial<Step>>): GoalMap {
  const changed = steps.map((one) => (changes[one.id] ? { ...one, ...changes[one.id] } : one));
  const next = buildForest([GOAL, OTHER], [...changed, ...otherSteps]);
  attachDependencies(next.byGoal, next.nodes, dependencies);
  return {
    ...map,
    steps: next.byGoal.get(GOAL) ?? [],
    linked: map.linked.map((link) => ({ ...link, step: next.nodes.get(link.step.id) ?? link.step })),
  };
}
