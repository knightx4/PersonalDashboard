import type { ComponentProps } from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { allGoalsCrumbs } from '@/lib/goals/crumbs';
import { Card } from '@/components/ui/card';
import { HomeView } from '@/app/goals/home-view';
import { GoalsView } from '@/app/goals/goals-view';
import { GoalAddRow } from '@/app/goals/[goalId]/goal-add-row';
import { GoalLinksSection } from '@/app/goals/[goalId]/goal-links';
import { GoalStatusCard } from '@/app/goals/[goalId]/goal-status';
import { FileBody } from '@/components/files/file-body';
import { FileLinks } from '@/components/files/file-links';
import { GoalNumber } from '@/app/goals/[goalId]/goal-number';
import { WaitingOnYou } from '@/app/goals/[goalId]/goal-flags';
import { GoalFog, GoalShaping } from '@/app/goals/[goalId]/goal-shaping';
import { StepTree } from '@/app/goals/[goalId]/step-tree';
import type { InformationSeam } from '@/app/goals/[goalId]/information-step';
import type { StepAnswer } from '@/lib/goals/answers';
import type { CollectionField } from '@/lib/goals/collections';
import type { Collection, CollectionRecord } from '@/lib/goals/collections-store';
import type { GoalLinks } from '@/lib/goals/links';
import type { Reading } from '@/lib/goals/readings';
import { goalRunRows, type RunListing } from '@/lib/goals/runs';
import { approvalLine } from '@/lib/goals/shaping';
import type { GoalReview } from '@/lib/goals/reviews';
import type { GoalProgress } from '@/lib/goals/status';
import { buildForest, type Step } from '@/lib/goals/steps';
import type { GoalMap } from '@/lib/goals/steps-store';
import type { AreaWithGoals, Goal } from '@/lib/goals/tree';
import { DashCredit } from '@/components/ui/dash-mark';
import { GoalDetail } from '@/app/goals/[goalId]/goal-detail';
import { GoalActivity } from '@/app/goals/[goalId]/goal-activity';
import { closedSteps, goalStages } from '@/lib/goals/goal-page';
import { goalProgress } from '@/lib/goals/status';
import { goalMapWith } from './goal-surfaces';
import { SetTab } from './set-tab';

/**
 * The Goals home, All goals, the top of a goal page and an information step,
 * drawn from fixtures for the gallery (plan #1043).
 *
 * An ordinary week on three goals: the credit cards have a question waiting
 * and a rhythm running late, the emergency fund has one dated step next, the
 * job hunt is waiting on other people so has nothing next, and the half
 * marathon has no steps at all. No clock is read anywhere in here; every
 * date is written out, so two shots differ only when the page does.
 */

const TODAY = '2026-09-25';

function goal(id: string, areaId: string, title: string, extra: Partial<Goal> = {}): Goal {
  return {
    id,
    areaId,
    title,
    acceptance: null,
    fog: null,
    status: 'open',
    position: 10,
    unit: null,
    target: null,
    ...extra,
  };
}

function progress(
  extra: Partial<GoalProgress> & Pick<GoalProgress, 'bands' | 'move'>,
): GoalProgress {
  const live = Object.values(extra.bands).reduce((a, b) => a + b, 0);
  return {
    live,
    done: extra.bands.done,
    moves: { on_you: 0, with_dash: 0, waiting: 0, settled: 0 },
    questions: 0,
    ...extra,
  };
}

const cards = goal('g-cards', 'a-money', 'Pay off the credit cards', {
  acceptance: 'Every card at a zero balance.',
  unit: '$',
  target: 0,
  createdAt: '2026-06-02T09:00:00Z',
});
const fund = goal('g-fund', 'a-money', 'Build an emergency fund', {
  acceptance: 'Three months of spending in the savings account.',
  position: 20,
});
const job = goal('g-job', 'a-career', 'Move into a quant research role', {
  acceptance: 'An offer from a fund or a bank for a research seat.',
});
const marathon = goal('g-run', 'a-health', 'Run a half marathon', {
  fog: 'Whether to aim for a time or just to finish.',
  createdAt: '2026-09-25T07:30:00Z',
});

/** The areas a goal can be moved to, for the menu in the page's header. */
const PLACES = [
  { id: 'a-money', name: 'Money' },
  { id: 'a-career', name: 'Career' },
  { id: 'a-health', name: 'Health' },
];

const cardsProgress = progress({
  bands: { on_you: 3, waiting: 1, with_dash: 1, done: 2 },
  move: 'on_you',
  questions: 1,
});

const cardsReview: GoalReview = {
  id: 'rev-1',
  goalId: cards.id,
  verdict: 'waiting_on_you',
  reason: 'Two steps closed this week and the next one is yours.',
  nextMove: 'Answer “Which card first?” so Dash can plan the payments.',
  nextOn: null,
  stepId: null,
  waitsOnId: null,
  runId: null,
  createdAt: '2026-09-21T08:00:00Z',
};

/* ------------------------------------------------------------------ home */

function review(
  goalId: string,
  extra: Partial<GoalReview> & Pick<GoalReview, 'verdict'>,
): GoalReview {
  return {
    id: `review-${goalId}`,
    goalId,
    reason: '',
    nextMove: '',
    nextOn: null,
    stepId: null,
    waitsOnId: null,
    runId: null,
    createdAt: `${TODAY}T06:00:00Z`,
    ...extra,
  };
}

const home: Omit<ComponentProps<typeof HomeView>, 'timeZone'> = {
  onYou: [
    {
      kind: 'question',
      id: 'which',
      title: 'Which card goes first?',
      detail: null,
      goalId: cards.id,
      goalTitle: cards.title,
      action: 'Answer',
      unblocks: 3,
      on: null,
    },
    {
      kind: 'step',
      id: 'standing',
      title: 'Set up a standing order of $200 on payday',
      detail: null,
      goalId: fund.id,
      goalTitle: fund.title,
      action: 'Done',
      unblocks: 0,
      on: '2026-10-01',
      prepared: {
        text: [
          '**Standing order** from the current account to the savings account.',
          '',
          '- Amount: $200',
          '- Day: the 28th, the day after payday',
          '- Reference: Emergency fund',
          '',
          'In the app: Payments, then Standing orders, then New.',
        ].join('\n'),
      },
    },
    {
      kind: 'rhythm',
      id: 'review',
      title: 'Check the budget every week',
      detail: '0 of 1 this week, 2 days left',
      goalId: cards.id,
      goalTitle: cards.title,
      action: 'Log one',
      unblocks: 0,
      on: null,
      startsOn: '2026-09-21',
    },
    {
      kind: 'went',
      id: 'sug-0',
      title: 'Did you go to Open evening at the options desk?',
      detail: null,
      goalId: job.id,
      goalTitle: job.title,
      action: 'I went',
      unblocks: 0,
      on: TODAY,
    },
    {
      kind: 'suggestion',
      id: 'sug-1',
      title: 'Quant finance meetup: volatility surfaces in practice',
      detail: 'The Railway Tavern, London',
      goalId: job.id,
      goalTitle: job.title,
      action: 'Going',
      unblocks: 0,
      on: '2026-10-01',
      url: 'https://example.com/meetup',
    },
    {
      kind: 'plan',
      id: 'a-health',
      title: 'Look over 2 goals proposed in Health',
      detail: null,
      goalId: 'g-sleep',
      goalTitle: 'Sleep before midnight',
      action: 'Review',
      unblocks: 0,
      on: null,
    },
  ],
  goals: [
    {
      goal: cards,
      areaName: 'Money',
      progress: cardsProgress,
      review: review(cards.id, {
        verdict: 'waiting_on_you',
        reason: 'The order of the cards decides the next three steps.',
        nextMove: 'Choose which card to pay first',
      }),
      current: true,
      next: null,
      hasSteps: true,
    },
    {
      goal: fund,
      areaName: 'Money',
      progress: progress({
        bands: { on_you: 1, waiting: 0, with_dash: 0, done: 1 },
        move: 'on_you',
      }),
      review: review(fund.id, {
        verdict: 'on_track',
        reason: 'The account is open.',
        nextMove: 'Set up the standing order',
        nextOn: '2026-10-01',
      }),
      current: true,
      next: null,
      hasSteps: true,
    },
    {
      goal: job,
      areaName: 'Career',
      progress: progress({
        bands: { on_you: 0, waiting: 2, with_dash: 0, done: 3 },
        move: 'waiting',
      }),
      review: review(job.id, {
        verdict: 'waiting_on_date',
        reason: 'Two recruiters have the CV.',
        nextMove: 'Check for replies',
        nextOn: '2026-09-28',
        createdAt: '2026-09-22T06:00:00Z',
      }),
      current: false,
      next: null,
      hasSteps: true,
    },
    {
      goal: marathon,
      areaName: 'Health',
      progress: progress({
        bands: { on_you: 0, waiting: 0, with_dash: 0, done: 0 },
        move: 'settled',
      }),
      review: null,
      current: false,
      next: null,
      hasSteps: false,
    },
    {
      goal: goal('g-boiler', 'a-money', 'Book the boiler service', {
        errand: true,
        dueOn: '2026-10-20',
        position: 30,
      }),
      areaName: 'Money',
      progress: progress({
        bands: { on_you: 0, waiting: 0, with_dash: 1, done: 0 },
        move: 'with_dash',
      }),
      review: null,
      current: false,
      next: null,
      hasSteps: true,
    },
  ],
  done: {
    since: '2026-09-24T19:30:00Z',
    items: [
      {
        kind: 'result',
        id: 'script',
        title: 'Draft what to say on the call',
        goalId: cards.id,
        goalTitle: cards.title,
        href: `/goals/${cards.id}/s/script`,
        unread: true,
        runId: 'run-1',
        undo: null,
        at: '2026-09-25T06:10:00Z',
      },
    ],
    more: 0,
  },
  todayOn: TODAY,
  areas: [
    { id: 'a-money', name: 'Money' },
    { id: 'a-career', name: 'Career' },
    { id: 'a-health', name: 'Health' },
    { id: 'a-city', name: 'The city and the people in it' },
  ],
  working: [
    {
      id: 'run-live',
      job: 'goal',
      status: 'started',
      createdAt: `${TODAY}T09:10:00Z`,
      endedAt: null,
      summary: null,
      error: null,
      lastSeenAt: `${TODAY}T09:14:00Z`,
      nowOn: 'Find quant research openings in London',
      item: { id: job.id, title: job.title, level: 'goal' },
    },
  ],
  offers: [
    {
      kind: 'prepare',
      stepId: 'standing',
      title: 'Set up a standing order of $200 on payday',
      goalId: fund.id,
      goalTitle: fund.title,
    },
    {
      kind: 'goal',
      goalId: marathon.id,
      title: marathon.title,
      reason: 'Dash has not worked on it yet.',
    },
  ],
  preparable: ['standing'],
  dash: [
    {
      id: 'apr',
      title: 'List every card with its APR and minimum',
      goalId: cards.id,
      goalTitle: cards.title,
      kind: 'step',
      working: false,
      needs: null,
    },
    {
      id: 'login',
      title: 'Pull the last three statements',
      goalId: cards.id,
      goalTitle: cards.title,
      kind: 'step',
      working: false,
      needs: 'Which bank is the Visa with?',
    },
  ],
  laterOn: [
    {
      id: 'raise',
      title: 'Raise the standing order to $300',
      goalId: fund.id,
      goalTitle: fund.title,
      startsOn: '2026-11-01',
      dueOn: null,
    },
  ],
  brief: {
    body: 'The card balance is down to **$6,980**, $730 lower than August. The one thing waiting on you is *Which card first?* on **Pay off the credit cards**: it decides the next three steps.\n\nThe job search is quiet until the recruiters reply, which they said would be by Monday. The half marathon has no steps yet; ask me to map it when you want to start.',
    when: 'today',
  },
};

export function GoalsHomeSurface() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Goals" />
      <HomeView {...home} timeZone="Europe/London" canRun />
    </div>
  );
}

/* ------------------------------------------------------------- all goals */

const areas: AreaWithGoals[] = [
  { id: 'a-money', name: 'Money', note: null, position: 10, goals: [cards, fund] },
  { id: 'a-career', name: 'Career', note: null, position: 20, goals: [job] },
  {
    id: 'a-health',
    name: 'Health',
    note: null,
    position: 30,
    goals: [marathon, goal('g-sleep', 'a-health', 'Sleep before midnight', { position: 20 })],
  },
  {
    id: 'a-city',
    name: 'The city',
    note: 'Know the people working on housing and transit here, and be one of them.',
    position: 40,
    goals: [],
  },
];

export function GoalsAllSurface() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="All goals" crumbs={allGoalsCrumbs()} />
      <GoalsView
        areas={areas}
        view="open"
        onYou={{ [cards.id]: 1 }}
        progress={{
          [cards.id]: cardsProgress,
          [fund.id]: home.goals[1].progress!,
          [job.id]: home.goals[2].progress!,
        }}
        areaRuns={{}}
        rhythms={{
          'a-money': [
            {
              id: 'r-budget',
              title: 'Check the budget every week',
              goalId: cards.id,
              line: '0 of 1 this week · For Pay off the credit cards',
            },
          ],
        }}
        canRun
      />
    </div>
  );
}

/* ------------------------------------------------------------- area page */

const moneyArea: AreaWithGoals = {
  id: 'a-money',
  name: 'Money',
  note: 'Out of card debt by spring, with three months of rent put by and nothing left to chance.',
  position: 10,
  goals: [
    cards,
    fund,
    goal('g-pension', 'a-money', 'Move the old workplace pension into one account', {
      status: 'proposed',
      position: 30,
      acceptance: 'Both old pensions are in the one account, with the transfer letters filed.',
    }),
    goal('g-insurance', 'a-money', 'Get contents insurance for the flat', {
      status: 'proposed',
      position: 40,
    }),
  ],
};

/** An area's own page (plan #1619): the Money area alone, two goals open and two Dash proposed. */
export function GoalsAreaSurface() {
  return (
    <div className="mx-auto max-w-3xl">
      <GoalsView
        areas={[moneyArea, ...areas.slice(1)]}
        areaId="a-money"
        view="open"
        onYou={{ [cards.id]: 1 }}
        progress={{ [cards.id]: cardsProgress, [fund.id]: home.goals[1].progress! }}
        areaRuns={{}}
        rhythms={{
          'a-money': [
            {
              id: 'r-budget',
              title: 'Check the budget every week',
              goalId: cards.id,
              line: '0 of 1 this week · For Pay off the credit cards',
            },
          ],
        }}
        canRun
      />
    </div>
  );
}

/* ------------------------------------------------------------ goal page */

const readings: Reading[] = [
  {
    id: 'r1',
    value: 8420,
    readOn: '2026-06-01',
    note: 'Both cards, from the statements',
    captureId: null,
  },
  { id: 'r2', value: 7960, readOn: '2026-07-01', note: null, captureId: null },
  {
    id: 'r3',
    value: 7710,
    readOn: '2026-08-01',
    note: 'Paid extra after the bonus',
    captureId: 'cap-1',
  },
  { id: 'r4', value: 6980, readOn: '2026-09-01', note: null, captureId: null },
];

const links: GoalLinks = {
  aims: [
    {
      linkId: 'l1',
      aimId: 'aim-1',
      name: 'Personal finance basics',
      archived: false,
      level3: null,
      cardsRead: 14,
      cardsSaved: 3,
    },
  ],
  jobSearch: null,
  jobs: [],
};

const aimChoices = [{ id: 'aim-2', name: 'Behavioural economics' }];

/** The fixed instant the run lines are measured from, a day after the latest run. */
const NOW = Date.parse('2026-09-25T09:00:00Z');

function run(
  id: string,
  createdAt: string,
  endedAt: string,
  extra: Partial<RunListing> = {},
): RunListing {
  return {
    id,
    job: 'goal',
    status: 'done',
    createdAt,
    endedAt,
    summary: null,
    error: null,
    lastSeenAt: null,
    nowOn: null,
    item: { id: cards.id, title: cards.title, level: 'goal' },
    ...extra,
  };
}

/** Three runs on the credit cards: an answer re-shape, one that failed, and the first mapping. */
const cardRuns = goalRunRows(
  [
    run('run-3', '2026-09-24T07:40:00Z', '2026-09-24T07:52:00Z', {
      job: 'reshape',
      summary: 'Drafted the call script and asked which card to start with.',
    }),
    run('run-2', '2026-09-20T07:00:00Z', '2026-09-20T07:00:02Z', {
      status: 'failed',
      error: 'The routine token was rejected.',
    }),
    run('run-1', '2026-09-01T08:10:00Z', '2026-09-01T08:31:00Z', {
      summary:
        'Mapped the goal: list the cards, call about the rates, then pay the highest rate first.',
    }),
  ],
  NOW,
  'Europe/London',
);

const cardFiles = [
  {
    fileId: 'f-rates',
    title: 'Which card to pay first',
    summary: 'Paying the 27% card first saves about $310 over paying the smaller balance first.',
  },
];

const FILE_BODY = `283 applications are in the tracker since March. **FP&A and accounting answer and interview best.** Strategic finance is 43% of what you sent but converts at about the average, and AI expert gigs and real estate barely answer.

| Role family | Sent | Replied | Interviewed | Rejected early |
|---|---:|---:|---:|---:|
| Strategic finance | 121 | 60 (50%) | 3 (2%) | 46 of 51 |
| FP&A | 38 | 24 (63%) | 9 (24%) | 8 of 12 |
| Accounting | 31 | 18 (58%) | 6 (19%) | 7 of 9 |
| Chief of staff & operations | 43 | 19 (44%) | 1 (2%) | 14 of 16 |

## What to do with it

1. Move two of this week's strategic finance slots to FP&A roles.
2. Lead the FP&A resume with the three-statement model.

## What this does not show

- 154 applications never answered, so their stage is unknown.

Read from the job search on 26 Sept. No applications or messages were sent.`;

/** A file as its page shows it: the body in its card. The summary is for lists. */
export function FileSurface() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Your applications by role family"
        description={
          <>
            <DashCredit />
            Written by Dash · updated Sat 26 Sept, 09:12
          </>
        }
      />
      <div className="space-y-6">
        <Card padding="standard">
          <FileBody markdown={FILE_BODY} />
        </Card>
      </div>
    </div>
  );
}

/**
 * The top of a goal page that has something in each part of its header
 * (plan #1078): Dash's verdict and the status line, the next move, Dash's
 * note folded, Ask Dash, the number with four monthly readings, and Waiting
 * on you with a question to answer in place and a result to read. Under it,
 * one Learn goal linked and a file, as More holds them. The page header is
 * the real one, with the path above it (plan #1622).
 */
export function GoalTopSurface() {
  const which = {
    ...step('which', {
      title: 'Which card first?',
      kind: 'decision',
      detail:
        'A — The 27% card. Saves the most interest.\nB — The smaller balance. Closes one card soonest.\nRecommend A.',
    }),
    children: [],
  };
  return (
    <GoalDetail
      goal={cards}
      areaName="Money"
      places={PLACES}
      review={cardsReview}
      progress={cardsProgress}
      timeZone="UTC"
    >
      <div className="space-y-6">
        <div className="space-y-4">
          <GoalStatusCard
            line="3 on you · 1 step ready for Dash"
            brief={{
              id: 'brief-1',
              itemId: cards.id,
              runId: null,
              body: 'Down to **$6,980** from $8,420 in June, about $480 a month, which clears both cards by next June. I compared the two rates ([the file](#)): paying the 27% card first saves about $310. Answering *Which card first?* settles the next three steps.',
              createdAt: '2026-09-25T08:00:00Z',
            }}
            briefWhen="today"
            current
            review={cardsReview}
            ask={
              <GoalShaping
                goalId={cards.id}
                approval={approvalLine({
                  goalStatus: 'open',
                  approvedAt: '2026-09-01T09:00:00Z',
                  proposed: 0,
                  questions: 1,
                })}
                runs={cardRuns}
                moreRuns={false}
                running={null}
                canRun
                quiet
              />
            }
          />
          <GoalNumber goalId={cards.id} unit="$" target={0} readings={readings} today={TODAY} />
          <WaitingOnYou
            rows={[
              {
                id: 'which',
                kind: 'question',
                label: 'Answer',
                title: 'Which card first?',
                href: '#step-which',
              },
              {
                id: 'compare',
                kind: 'read',
                label: 'Read Dash’s result',
                title: 'Compare the two cards’ rates',
                href: '#step-compare',
              },
              {
                id: 'call',
                kind: 'do',
                label: 'Do by 3 Oct',
                title: 'Call the card company',
                href: '#step-call',
              },
            ]}
            flags={[]}
            questions={{ which }}
          />
        </div>
        <GoalLinksSection goalId={cards.id} links={links} aimChoices={aimChoices} jobsOn />
        <section aria-labelledby="files-heading" className="space-y-2">
          <h2 id="files-heading" className="px-1 text-ui font-semibold text-ink">
            Files
          </h2>
          <FileLinks files={cardFiles} />
        </section>
      </div>
    </GoalDetail>
  );
}

/**
 * A goal just added: not approved, nothing measured, no help asked for and
 * nothing linked, so the page has its fog, the Claude card and one row of
 * add lines.
 */
export function GoalBareSurface() {
  const number = { goalId: marathon.id, unit: null, target: null, readings: [], today: TODAY };
  return (
    <GoalDetail
      goal={marathon}
      areaName="Health"
      places={PLACES}
      review={null}
      progress={progress({
        bands: { on_you: 0, waiting: 0, with_dash: 0, done: 0 },
        move: 'settled',
      })}
      timeZone="UTC"
    >
      <div className="space-y-6">
        <GoalFog goalId={marathon.id} fog={marathon.fog!} aside={false} />
        <GoalShaping
          goalId={marathon.id}
          approval={approvalLine({
            goalStatus: 'open',
            approvedAt: null,
            proposed: 0,
            questions: 0,
          })}
          runs={[]}
          moreRuns={false}
          running={null}
          canRun
          quiet
        />
        <GoalAddRow
          number={number}
          help={{ goalId: marathon.id, helpKinds: [] }}
          links={{
            goalId: marathon.id,
            links: { aims: [], jobSearch: null, jobs: [] },
            aimChoices,
            jobsOn: true,
          }}
        />
      </div>
    </GoalDetail>
  );
}

/* ------------------------------------------------------ information step */

function step(id: string, extra: Partial<Step> & { title: string }): Step {
  return {
    id,
    parentId: cards.id,
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

const incomeFields: CollectionField[] = [
  { key: 'pay', label: 'Monthly take-home pay', type: 'money', tracked: true },
  { key: 'payday', label: 'Payday', type: 'day_of_month' },
  { key: 'employer', label: 'Employer', type: 'text' },
  { key: 'other', label: 'Other income', type: 'money' },
  { key: 'tax_code', label: 'Tax code', type: 'text' },
  { key: 'pension', label: 'Pension contribution', type: 'percent' },
];

const income: Collection = {
  id: 'col-income',
  name: 'Income',
  shape: 'one',
  version: 1,
  goalIds: [cards.id],
  fields: incomeFields,
};

const incomeRecord: CollectionRecord = {
  id: 'rec-income',
  collectionId: income.id,
  data: {
    pay: 3150,
    payday: 28,
    employer: 'Northwind Analytics Ltd',
    other: null,
    tax_code: '1257L',
    pension: 5,
  },
  version: 1,
  position: 10,
  source: 'document',
  sourceRef: 'user-1/0b8f3c1e-5a2d-4d7e-9f10-2c3b4a5d6e7f-payslip-august-2026.pdf',
  draft: false,
  asOf: '2026-08-28',
  updatedAt: '2026-09-02T19:14:00Z',
};

/** Nineteen fields, as a loan's paperwork gives them; the step asks for four. */
const loanFields: CollectionField[] = [
  { key: 'lender', label: 'Lender', type: 'text', id: true },
  { key: 'balance', label: 'Balance', type: 'money', tracked: true },
  { key: 'rate', label: 'Interest rate', type: 'percent' },
  { key: 'payment', label: 'Monthly payment', type: 'money' },
  { key: 'due_day', label: 'Payment day', type: 'day_of_month' },
  { key: 'account', label: 'Account number', type: 'text' },
  {
    key: 'kind',
    label: 'Kind of loan',
    type: 'choice',
    options: ['Car', 'Personal', 'Student', 'Other'],
  },
  { key: 'started', label: 'Started', type: 'date' },
  { key: 'ends', label: 'Final payment', type: 'date' },
  { key: 'original', label: 'Amount borrowed', type: 'money' },
  { key: 'term', label: 'Term in months', type: 'number' },
  { key: 'fixed', label: 'Fixed rate', type: 'yes_no' },
  { key: 'autopay', label: 'Paid by direct debit', type: 'yes_no' },
  { key: 'secured', label: 'Secured', type: 'yes_no' },
  { key: 'early_fee', label: 'Early repayment charge', type: 'money' },
  { key: 'statement_day', label: 'Statement day', type: 'day_of_month' },
  { key: 'website', label: 'Website', type: 'link' },
  { key: 'phone', label: 'Phone', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'long_text' },
];

const loans: Collection = {
  id: 'col-loans',
  name: 'Loans',
  shape: 'list',
  version: 1,
  goalIds: [cards.id],
  fields: loanFields,
};

function loan(id: string, position: number, extra: Partial<CollectionRecord>): CollectionRecord {
  return {
    id,
    collectionId: loans.id,
    data: {},
    version: 1,
    position,
    source: 'typed',
    sourceRef: null,
    draft: false,
    asOf: null,
    updatedAt: '2026-09-10T08:00:00Z',
    ...extra,
  };
}

const loanRecords: CollectionRecord[] = [
  loan('loan-car', 10, {
    data: {
      lender: 'Black Horse Finance',
      balance: 8645.3,
      rate: 7.9,
      payment: 289.5,
      due_day: 1,
      account: '40021977',
      kind: 'Car',
      started: '2024-03-01',
      ends: '2028-02-01',
      original: 14500,
      term: 48,
      fixed: true,
      autopay: true,
      secured: true,
      early_fee: null,
      statement_day: null,
      website: 'https://www.blackhorse.co.uk',
      phone: '0344 824 8888',
      notes: 'Balloon payment at the end is optional.',
    },
    source: 'document',
    sourceRef: 'user-1/7a1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d-car-finance-agreement.pdf',
  }),
  loan('loan-student', 20, {
    data: {
      lender: 'Student Loans Company',
      balance: 41230,
      rate: null,
      payment: 112,
      due_day: null,
    },
    source: 'gmail',
    sourceRef: '18f2a9c4d7e1b305',
    draft: true,
  }),
  loan('loan-personal', 30, {
    data: { lender: 'Zopa', balance: 2310, rate: 12.4, payment: 95, due_day: 15, kind: 'Personal' },
  }),
];

const incomeStep = step('income', {
  title: 'Write down what comes in each month',
  detail: 'Take-home pay and the day it lands, from the latest payslip.',
  collectionId: income.id,
  asksFor: ['pay', 'payday'],
});

const loansStep = step('loans', {
  title: 'List every loan with its balance and rate',
  detail: 'The car, the student loan and anything else with a monthly payment.',
  collectionId: loans.id,
  asksFor: ['balance', 'rate', 'payment', 'due_day'],
  // Three questions (plan #991): one answered, one out of date, one open.
  questions: [
    { key: 'monthly_total', question: 'What is the monthly total?' },
    { key: 'car_paid_off', question: 'When is the car paid off?' },
    { key: 'student_first_payment', question: 'When does the student loan start charging?' },
  ],
  position: 20,
});

/** The loans step's worked-out answers: one standing, one out of date (plan #989). */
const loanAnswers: StepAnswer[] = [
  {
    id: 'answer-total',
    itemId: loansStep.id,
    key: 'monthly_total',
    question: 'What is the monthly total?',
    answer: 'About $496 a month across the three loans.',
    sources: [
      { recordId: 'loan-car', asOf: '2026-09-02' },
      { recordId: 'loan-student', asOf: '2026-09-02' },
      { recordId: 'loan-personal', asOf: '2026-09-02' },
    ],
    position: 10,
    workedAt: '2026-09-10T08:00:00Z',
    outOfDateAt: '2026-09-12T09:30:00Z',
    value: { kind: 'amount', amount: 496 },
    closed: null,
    changed: null,
    meaning: null,
  },
  {
    id: 'answer-car-ends',
    itemId: loansStep.id,
    key: 'car_paid_off',
    question: 'When is the car paid off?',
    answer: '1 Feb 2028, with the balloon payment optional.',
    sources: [{ recordId: 'loan-car', asOf: '2026-08-28' }],
    position: 20,
    workedAt: '2026-09-10T08:00:00Z',
    outOfDateAt: null,
    value: { kind: 'date', date: '2028-02-01' },
    // Moved by the latest statement, so the step shows what it said before (plan #997).
    closed: { answer: '1 Mar 2028.', value: { kind: 'date', date: '2028-03-01' } },
    changed: { at: '2026-09-10T08:00:00Z', recordId: 'loan-car' },
    meaning: null,
  },
];

function infoMap(only: Step): GoalMap {
  const forest = buildForest([cards.id], [only]);
  return {
    goal: cards,
    areaName: 'Money',
    steps: forest.byGoal.get(cards.id) ?? [],
    linked: [],
    otherGoals: [],
    linksOf: {},
    rhythms: {},
    information: {
      [income.id]: { collection: income, records: [incomeRecord] },
      [loans.id]: { collection: loans, records: loanRecords },
    },
    answers: { [loansStep.id]: loanAnswers },
    threads: {},
  };
}

/** A one-record step opened: its two asked values, and the other four folded. */
export function InformationOneSurface() {
  return <StepTree map={infoMap(incomeStep)} todoOn={false} opened />;
}

/** A list step opened: three loans, one a draft from Gmail with a gap. */
export function InformationListSurface({ seam }: { seam?: InformationSeam }) {
  return <StepTree map={infoMap(loansStep)} todoOn={false} opened informationSeam={seam} />;
}

/** The bare goal's Link line pressed: the picker in a card of its own. */
export function GoalLinkingSurface() {
  return (
    <div className="mx-auto max-w-3xl">
      <GoalLinksSection
        goalId={marathon.id}
        links={{ aims: [], jobSearch: null, jobs: [] }}
        aimChoices={aimChoices}
        jobsOn
        startAdding
      />
    </div>
  );
}

/* ------------------------------------------------ the goal page's tabs */

/**
 * The credit-card goal from the steps' fixtures (goal-surfaces.tsx), with
 * the times its closed steps were closed, for the Steps and Activity tabs
 * (plan #1671).
 */
const tabbedMap = goalMapWith({
  list: { closedAt: '2026-09-18T10:00:00Z' },
  script: { closedAt: '2026-09-23T07:15:00Z' },
  overdraft: { closedAt: '2026-09-10T16:40:00Z' },
});
const tabbedGoal: Goal = {
  ...tabbedMap.goal,
  createdAt: '2026-09-02T09:00:00Z',
  dueOn: '2027-06-30',
};

function TabbedGoal({ children }: { children: React.ReactNode }) {
  return (
    <GoalDetail
      goal={tabbedGoal}
      areaName={tabbedMap.areaName}
      places={PLACES}
      review={cardsReview}
      progress={goalProgress(tabbedMap.steps)}
      timeZone="UTC"
    >
      {children}
    </GoalDetail>
  );
}

/** A goal's page on its Steps tab: the step tree with its stages and rhythm. */
export function GoalStepsTabSurface() {
  return (
    <>
      <SetTab tab="steps" />
      <TabbedGoal>
        <StepTree map={tabbedMap} stages={goalStages(tabbedMap.steps)} todoOn={false} />
      </TabbedGoal>
    </>
  );
}

/**
 * The same goal on its Activity tab: the steps closed, newest first, one of
 * them Dash's and one dropped, the goal's runs, and its comments.
 */
export function GoalActivitySurface() {
  return (
    <>
      <SetTab tab="activity" />
      <TabbedGoal>
        <GoalActivity
          goalId={tabbedGoal.id}
          closed={closedSteps(tabbedMap.steps)}
          runs={cardRuns}
          moreRuns
          thread={[
            {
              id: 'turn-1',
              author: 'me',
              body: 'The card company said to call back after the statement on the 3rd.',
              createdAt: '2026-09-24T17:20:00Z',
            },
            {
              id: 'turn-2',
              author: 'claude',
              body: 'Noted. I have moved the call to after 3 Oct and kept the script as it is.',
              createdAt: '2026-09-24T17:22:00Z',
            },
          ]}
          timeZone="UTC"
        />
      </TabbedGoal>
    </>
  );
}
