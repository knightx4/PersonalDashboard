import { GoalDetail } from '@/app/goals/[goalId]/goal-detail';
import { GoalPlan, type PlanView } from '@/app/goals/[goalId]/goal-plan';
import { StepTree } from '@/app/goals/[goalId]/step-tree';
import { attachDependencies, type DependencyRow } from '@/lib/goals/dependencies';
import { goalStages } from '@/lib/goals/goal-page';
import { goalProgress } from '@/lib/goals/status';
import { buildForest, markStartDates, type Step } from '@/lib/goals/steps';
import type { GoalMap } from '@/lib/goals/steps-store';
import type { Goal } from '@/lib/goals/tree';
import { SetTab } from './set-tab';

/**
 * A goal's Plan tab (plan #2778.5) on the two goals the approved mockups were
 * drawn from, with made-up loans, rooms and people of the same shape: the
 * student loans in five stages, and an apartment in rooms with a long tail of
 * steps. No clock is read; today is written out.
 */

const TODAY = '2026-11-04';

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

function mapOf(
  goal: Goal,
  areaName: string,
  steps: Step[],
  dependencies: DependencyRow[] = [],
  threads: GoalMap['threads'] = {},
): GoalMap {
  const forest = buildForest([goal.id], steps.map((one, i) => ({ ...one, position: (i + 1) * 10 })));
  attachDependencies(forest.byGoal, forest.nodes, dependencies);
  markStartDates(forest.byGoal, TODAY);
  return {
    goal,
    areaName,
    steps: forest.byGoal.get(goal.id) ?? [],
    linked: [],
    otherGoals: [],
    linksOf: {},
    rhythms: {},
    information: {},
    answers: {},
    threads,
  };
}

/* ------------------------------------------------------------- the loans */

const LOANS = 'goal-plan-loans';
const loansGoal: Goal = {
  id: LOANS,
  areaId: 'a-money',
  title: 'Pay off the student loans',
  acceptance: 'Every student loan paid off.',
  status: 'open',
  position: 10,
  unit: null,
  target: null,
  createdAt: '2026-09-24T09:00:00Z',
  dueOn: '2037-07-31',
  duePrecision: 'month',
};

const closed = (day: string) => ({ status: 'done' as const, closedAt: `${day}T10:00:00Z` });

const HOWTO = `Turn on autopay at the servicer’s site, loan by loan.

1. Sign in at the servicer’s site.
2. Open Make a Payment, then Autopay.
3. Choose the checking account and the monthly amount.
4. Repeat for each loan if the site sets autopay one at a time.
5. Keep the confirmation; it goes under Waiting for in Files.`;

const loansSteps: Step[] = [
  step('l-numbers', LOANS, { title: 'Get the numbers', ...closed('2026-09-25') }),
  step('l-list', 'l-numbers', { title: 'List your loan balances, rates and minimum payments', ...closed('2026-09-25') }),
  step('l-options', 'l-numbers', { title: 'Check refinancing, income-driven and forgiveness options', ...closed('2026-09-25') }),
  step('l-order', LOANS, { title: 'Choose the payoff order', ...closed('2026-10-03') }),
  step('l-which', 'l-order', {
    title: 'Highest interest first, or smallest balance first?',
    kind: 'decision',
    resolution: 'Highest rate first.',
    ...closed('2026-09-24'),
  }),
  step('l-refi', 'l-order', { title: 'Refinance once income qualifies', status: 'dropped', closedAt: '2026-10-03T10:00:00Z' }),
  step('l-schedule', LOANS, { title: 'Build the schedule', ...closed('2026-09-25') }),
  step('l-month', 'l-schedule', { title: 'Build the month-by-month payoff schedule', kind: 'claude', ...closed('2026-09-25') }),
  step('l-payments', LOANS, { title: 'Set up the payments' }),
  step('l-apply', 'l-payments', { title: 'Apply for the repayment plan on all four loans', ...closed('2026-11-03') }),
  step('l-letter', 'l-payments', {
    title: 'Save the servicer’s approval letter showing the $0 payment',
    detail:
      'The application went in on 2 Nov. When the letter lands in Gmail, Dash files it under Work & files and asks you to tick this.',
  }),
  step('l-autopay', 'l-payments', {
    title: 'Turn on autopay for every loan',
    dueOn: '2026-12-18',
    detail: 'Autopay usually takes 0.25% off the rate. Best done once the approval sets the payment.',
  }),
  step('l-howto', 'l-payments', {
    title: 'Write the autopay how-to',
    kind: 'claude',
    preparesId: 'l-autopay',
    result: HOWTO,
    reviewedAt: '2026-11-03T12:00:00Z',
    ...closed('2026-11-03'),
  }),
  step('l-track', LOANS, { title: 'Keep it on track' }),
  step('l-extra', 'l-track', {
    title: 'Send the extra payment to the 9.08% Grad PLUS loan',
    detail: 'Highest rate first · 9.08% on $52,000',
    startsOn: '2026-12-18',
  }),
  step('l-log', 'l-track', {
    title: 'Log each loan balance',
    kind: 'rhythm',
    rhythmCount: 1,
    rhythmPeriod: 'month',
  }),
  step('l-recert', 'l-track', { title: 'Recertify income for the repayment plan' }),
];

/** The Plan tab's map of the loans goal. */
export const loansPlanMap = mapOf(
  loansGoal,
  'Money',
  loansSteps,
  [{ id: 'dep-recert', itemId: 'l-recert', dependsOnId: 'l-letter' }],
  {
    'l-autopay': [
      {
        id: 'c-autopay',
        author: 'me',
        body: 'Does autopay need the same account for all four?',
        createdAt: '2026-11-03T18:00:00Z',
      },
    ],
  },
);

/* --------------------------------------------------------- the apartment */

const FLAT = 'goal-plan-flat';
const flatGoal: Goal = {
  id: FLAT,
  areaId: 'a-home',
  title: 'Make the apartment clean and livable',
  acceptance: 'Every room has a place for what lives in it, and the hallway is walkable.',
  status: 'open',
  position: 10,
  unit: null,
  target: null,
  createdAt: '2026-09-28T09:00:00Z',
};

const ROOMS: [string, string, string[]][] = [
  ['kitchen', 'Kitchen', ['Take the dish rack out of its box and set it by the sink']],
  ['hall', 'Hallway', ['Flatten and recycle the empty boxes']],
  ['bed', 'Bedroom', ['Clear the bedroom floor', 'Put the winter bedding in the vacuum bags']],
  ['entry', 'Entry closet', ['Make room to hang winter coats']],
  ['laundry', 'Washer and dryer closet', ['Move what is stored in front of the machines', 'Put the laundry supplies on one shelf']],
  ['living', 'Living room', ['Order the pantry cabinet', 'Move the rugs downstairs', 'Put up the floating shelves']],
  ['office', 'Office', ['Move the L-shaped desk to the window wall', 'Hang the pegboard over the desk']],
];

const flatSteps: Step[] = [
  step('f-plan', FLAT, { title: 'Planning with Alex' }),
  step('f-map', 'f-plan', {
    title: 'Walk through the room map with Alex',
    status: 'blocked',
    blockKind: 'outside',
    blockAsk: 'Alex free for an evening',
  }),
  step('f-measure', 'f-plan', { title: 'Measure the storage room and the living-room wall', startsOn: '2026-11-15' }),
  ...ROOMS.flatMap(([id, title, todo]) => [
    step(`f-${id}`, FLAT, { title }),
    step(`f-${id}-done`, `f-${id}`, { title: `Clear the surfaces in the ${title.toLowerCase()}`, ...closed('2026-10-27') }),
    ...todo.map((one, i) =>
      step(`f-${id}-${i}`, `f-${id}`, {
        title: one,
        detail:
          id === 'kitchen'
            ? 'The last open step in getting the kitchen to a clear baseline.'
            : id === 'hall'
              ? 'Packaging, not her things, so it is yours to clear. The hallway being walkable is part of the done-when.'
              : id === 'bed' && i === 0
                ? 'Laundry to the hamper, bedding on the bed, drawers closed.'
                : null,
      }),
    ),
  ]),
];

/** The Plan tab's map of the apartment goal, in rooms. */
export const flatPlanMap = mapOf(flatGoal, 'Home', flatSteps, [
  { id: 'dep-pantry', itemId: 'f-living-0', dependsOnId: 'f-measure' },
]);

/* -------------------------------------------------------------- surfaces */

function PlanFrame({ map, children }: { map: GoalMap; children: React.ReactNode }) {
  return (
    <GoalDetail
      goal={map.goal}
      areaName={map.areaName}
      places={[]}
      review={null}
      progress={goalProgress(map.steps)}
      timeZone="UTC"
    >
      {children}
    </GoalDetail>
  );
}

/**
 * A goal on its Plan tab. `view` is What's next or By stage; `draftOpen`
 * opens Dash's draft on the step that has one, `laterAll` lists every later
 * step, and `doneOpen` opens the finished fold.
 */
export function GoalPlanSurface({
  goal = 'loans',
  view = 'next',
  laterAll = false,
  doneOpen = false,
  draftOpen = false,
}: {
  goal?: 'loans' | 'flat' | 'empty';
  view?: PlanView;
  laterAll?: boolean;
  doneOpen?: boolean;
  draftOpen?: boolean;
}) {
  const map =
    goal === 'flat'
      ? flatPlanMap
      : goal === 'empty'
        ? { ...loansPlanMap, steps: [], threads: {} }
        : loansPlanMap;
  return (
    <>
      <SetTab tab="plan" params={view === 'stage' ? { view: 'stage' } : undefined} />
      <PlanFrame map={map}>
        <GoalPlan
          map={map}
          view={view}
          stageWord={goal === 'flat' ? 'room' : 'stage'}
          canRun
          today={TODAY}
          timeZone="UTC"
          later={laterAll}
          doneOpen={doneOpen}
          draftOpen={draftOpen}
          byStage={
            view === 'stage' && (
              <StepTree map={map} stages={goalStages(map.steps)} todoOn={false} byStage />
            )
          }
        />
      </PlanFrame>
    </>
  );
}
