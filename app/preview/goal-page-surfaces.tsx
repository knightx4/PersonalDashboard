import type { ComponentProps } from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { DailyView } from '@/app/goals/daily-view';
import { GoalsView } from '@/app/goals/goals-view';
import { GoalAddRow } from '@/app/goals/[goalId]/goal-add-row';
import { GoalLinksSection } from '@/app/goals/[goalId]/goal-links';
import { GoalNumber } from '@/app/goals/[goalId]/goal-number';
import { GoalFog, GoalShaping } from '@/app/goals/[goalId]/goal-shaping';
import { StepTree } from '@/app/goals/[goalId]/step-tree';
import type { InformationSeam } from '@/app/goals/[goalId]/information-step';
import type { CollectionField } from '@/lib/goals/collections';
import type { Collection, CollectionRecord } from '@/lib/goals/collections-store';
import type { GoalLinks } from '@/lib/goals/links';
import type { Reading } from '@/lib/goals/readings';
import { approvalLine, changesLine, runLine } from '@/lib/goals/shaping';
import type { GoalProgress } from '@/lib/goals/status';
import { buildForest, type Step } from '@/lib/goals/steps';
import type { GoalMap } from '@/lib/goals/steps-store';
import type { AreaWithGoals, Goal } from '@/lib/goals/tree';

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

function progress(extra: Partial<GoalProgress> & Pick<GoalProgress, 'bands' | 'move'>): GoalProgress {
  const live = Object.values(extra.bands).reduce((a, b) => a + b, 0);
  return {
    live,
    done: extra.bands.done,
    moves: { on_you: 0, with_claude: 0, waiting: 0, settled: 0 },
    questions: 0,
    ...extra,
  };
}

const cards = goal('g-cards', 'a-money', 'Pay off the credit cards', {
  acceptance: 'Every card at a zero balance.',
  unit: '$',
  target: 0,
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
});

const cardsProgress = progress({
  bands: { on_you: 3, waiting: 1, with_claude: 1, done: 2 },
  move: 'on_you',
  questions: 1,
});

/* ------------------------------------------------------------------ home */

const home: ComponentProps<typeof DailyView>['view'] = {
  waiting: [
    {
      kind: 'question',
      id: 'which',
      title: 'Which card goes first?',
      goalId: cards.id,
      goalTitle: cards.title,
    },
    {
      kind: 'review',
      id: 'script',
      title: 'Draft what to say on the call',
      goalId: cards.id,
      goalTitle: cards.title,
    },
  ],
  suggestions: [
    {
      id: 'sug-1',
      itemId: null,
      kind: 'events',
      title: 'Quant finance meetup: volatility surfaces in practice',
      detail: 'A talk and drinks, in the back room of a pub near Liverpool Street.',
      url: 'https://example.com/meetup',
      place: 'The Railway Tavern, London',
      source: 'Meetup',
      happensOn: '2026-10-01',
      startsAt: '2026-10-01T18:30:00+01:00',
      reaction: null,
      attended: null,
      createdAt: '2026-09-21T06:00:00Z',
    },
  ],
  rhythms: [
    {
      id: 'review',
      title: 'Check the budget every week',
      target: 1,
      period: 'week',
      goalId: cards.id,
      goalTitle: cards.title,
      count: 0,
      daysLeft: 2,
      atRisk: true,
      missed: 1,
    },
  ],
  goals: [
    {
      goal: cards,
      areaName: 'Money',
      next: [
        { id: 'call', title: 'Call the card company', kind: 'mine', dueOn: '2026-10-03', under: 'Get the rates lowered' },
        { id: 'consolidate', title: 'Look into a consolidation loan', kind: 'claude', dueOn: null, under: null },
        { id: 'income', title: 'Write down what comes in each month', kind: 'mine', dueOn: null, under: null },
      ],
      more: 2,
      hasSteps: true,
      progress: cardsProgress,
    },
    {
      goal: fund,
      areaName: 'Money',
      next: [
        {
          id: 'standing',
          title: 'Set up a standing order of $200 on payday',
          kind: 'mine',
          dueOn: '2026-10-01',
          under: null,
        },
      ],
      more: 0,
      hasSteps: true,
      progress: progress({ bands: { on_you: 1, waiting: 0, with_claude: 0, done: 1 }, move: 'on_you' }),
    },
    {
      goal: job,
      areaName: 'Career',
      next: [],
      more: 0,
      hasSteps: true,
      progress: progress({ bands: { on_you: 0, waiting: 2, with_claude: 0, done: 3 }, move: 'waiting' }),
    },
    { goal: marathon, areaName: 'Health', next: [], more: 0, hasSteps: false },
  ],
};

export function GoalsHomeSurface() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Goals" />
      <DailyView view={home} timeZone="Europe/London" />
    </div>
  );
}

/* ------------------------------------------------------------- all goals */

const areas: AreaWithGoals[] = [
  { id: 'a-money', name: 'Money', position: 10, goals: [cards, fund] },
  { id: 'a-career', name: 'Career', position: 20, goals: [job] },
  {
    id: 'a-health',
    name: 'Health',
    position: 30,
    goals: [marathon, goal('g-sleep', 'a-health', 'Sleep before midnight', { position: 20 })],
  },
];

export function GoalsAllSurface() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="All goals" />
      <GoalsView
        areas={areas}
        progress={{
          [cards.id]: cardsProgress,
          [fund.id]: home.goals[1].progress!,
          [job.id]: home.goals[2].progress!,
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ goal page */

const readings: Reading[] = [
  { id: 'r1', value: 8420, readOn: '2026-06-01', note: 'Both cards, from the statements', captureId: null },
  { id: 'r2', value: 7960, readOn: '2026-07-01', note: null, captureId: null },
  { id: 'r3', value: 7710, readOn: '2026-08-01', note: 'Paid extra after the bonus', captureId: 'cap-1' },
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

/** The fixed instant the run lines are measured from, a day after the run. */
const NOW = Date.parse('2026-09-25T09:00:00Z');
const stamp = (iso: string) =>
  `on ${new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))}`;

/**
 * The top of a goal page that has something in each section: the Claude
 * line, the number with four monthly readings, and one Learn goal linked. The
 * page header is the real one; the back link above it is the page's own and
 * is left out.
 */
export function GoalTopSurface() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={cards.title} description={cards.acceptance ?? undefined} />
      <div className="space-y-6">
        <GoalShaping
          goalId={cards.id}
          approval={approvalLine({
            goalStatus: 'open',
            approvedAt: '2026-09-01T09:00:00Z',
            proposed: 0,
            questions: 1,
          })}
          runLine={runLine(
            {
              id: 'run-1',
              status: 'done',
              createdAt: '2026-09-24T07:40:00Z',
              endedAt: '2026-09-24T07:52:00Z',
              summary: 'Drafted the call script and asked which card to start with.',
              error: null,
            },
            NOW,
            stamp,
          )}
          runFailed={false}
          changes={changesLine({ stepsAdded: 1, questionsAsked: 1, formsFilled: 0, stepsDone: 0 })}
          running={null}
          canRun
        />
        <GoalNumber goalId={cards.id} unit="$" target={0} readings={readings} today={TODAY} />
        <GoalLinksSection goalId={cards.id} links={links} aimChoices={aimChoices} jobsOn />
      </div>
    </div>
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
    <div className="mx-auto max-w-3xl">
      <PageHeader title={marathon.title} />
      <GoalFog goalId={marathon.id} fog={marathon.fog!} aside={false} />
      <div className="space-y-6">
        <GoalShaping
          goalId={marathon.id}
          approval={approvalLine({ goalStatus: 'open', approvedAt: null, proposed: 0, questions: 0 })}
          runLine={null}
          runFailed={false}
          changes={null}
          running={null}
          canRun
        />
        <GoalAddRow
          number={number}
          help={{ goalId: marathon.id, helpKinds: [] }}
          links={{ goalId: marathon.id, links: { aims: [], jobSearch: null, jobs: [] }, aimChoices, jobsOn: true }}
        />
      </div>
    </div>
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
  data: { pay: 3150, payday: 28, employer: 'Northwind Analytics Ltd', other: null, tax_code: '1257L', pension: 5 },
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
  { key: 'kind', label: 'Kind of loan', type: 'choice', options: ['Car', 'Personal', 'Student', 'Other'] },
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
    data: { lender: 'Student Loans Company', balance: 41230, rate: null, payment: 112, due_day: null },
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
  position: 20,
});

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
