import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { MODELS, SONNET } from '@/lib/core/models';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import { EssaysView } from '@/app/learn/essays/essays-view';
import { EssayView } from '@/app/learn/e/[id]/essay-view';
import { PlanSection } from '@/app/learn/s/[id]/plan';
import { openingAsk } from '@/lib/learn/essays/interview';
import type { Essay, EssayPin, EssaySummary } from '@/lib/learn/essays/model';
import type { PlanUnit } from '@/lib/learn/lessons/plan-view';
import type { ProjectView } from '@/lib/learn/lessons/project';
import { ESSAY_VAULT_ERRORS } from '@/lib/learn/essays/vault';

/**
 * The Essays list and the essay editor (plan #1865), from fixtures shaped like
 * `learn.essays` rows. The economics thread the other Learn surfaces use runs
 * through the essays too.
 */

const NOW = new Date('2026-10-12T15:00:00Z');

const essays: EssaySummary[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Why money is the odd good out',
    question: 'Why does money not wear out the way every other good does?',
    words: 812,
    wordTarget: 1200,
    publishedAt: null,
    updatedAt: '2026-10-12T14:20:00Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    title:
      'Elasticity explains why petrol taxes raise money and restaurant taxes raise complaints, and why the difference matters for anyone setting a price',
    question: '',
    words: 1640,
    wordTarget: null,
    publishedAt: '2026-10-04T09:00:00Z',
    updatedAt: '2026-10-04T09:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    title: 'Untitled essay',
    question: '',
    words: 0,
    wordTarget: null,
    publishedAt: null,
    updatedAt: '2025-12-30T18:00:00Z',
  },
];

export function LearnEssaysSurface() {
  return <EssaysView essays={essays} now={NOW} />;
}

export function LearnEssaysEmptySurface() {
  return <EssaysView essays={[]} now={NOW} />;
}

const draft = `# Why money is the odd good out

Every good you buy wears out, gets eaten or goes out of fashion. A loaf is worth less on Thursday than on Monday. A coat is worth less after a winter. Money is the one good we expect to hold its value while it sits in a drawer, and that expectation is *strange* once you look at it.

## What a good is for

Walzer says each good has a **sphere**: the reasons it is handed out belong to what it is. Bread goes to the hungry, offices to the qualified. Money is the good whose sphere is every other sphere, which is why it keeps leaking across the borders he draws.

> Money is the universal pander.

If that is right, money is less a good than a solvent. It holds its value only because it can turn into everything else, and the moment it cannot, as in a hyperinflation, nobody wants to hold it at all.

## The objection

The obvious reply is that gold held its value for centuries without being a solvent for anything. `;

/** One rephrase accepted earlier (plan #1868): Dash's sentence, marked as Dash's. */
const DASH_SENTENCE = 'If that is right, money is less a good than a solvent.';
const dashAt = draft.indexOf(DASH_SENTENCE);

const essay: Essay = {
  id: '00000000-0000-4000-8000-000000000001',
  path: 'Essays/Why money is the odd good out.md',
  noteId: '00000000-0000-4000-8000-0000000000a1',
  blobSha: '8642505e205f8a563b8b6c376bef88a1d7c3e0f2',
  draftBody: draft,
  marks: [
    {
      author: 'dash',
      from: dashAt,
      to: dashAt + DASH_SENTENCE.length,
      name: MODELS.learnEssayRephrase,
    },
  ],
  unsaved: true,
  brief: {
    question: 'Why does money not wear out the way every other good does?',
    claim: 'Money holds its value only because it can become every other good.',
    reader: 'A friend who knows nothing about economics',
    origin:
      'Reading Walzer on spheres of justice, and noticing my savings were the only thing I owned that I expected to be worth the same next year.',
    change:
      'A good that held its value for centuries without anyone being able to swap it for everything else.',
    pinned: [
      {
        kind: 'reading',
        id: '00000000-0000-4000-8000-0000000000b1',
        title: 'Walzer - Spheres of Justice ch4',
      },
    ],
  },
  interview: { status: 'done' },
  wordTarget: 1200,
  publishedAt: null,
  updatedAt: '2026-10-12T14:20:00Z',
};

/** About what one Rephrase costs, as the Learn layout would give it (law 16). */
const rephraseCost: CostEstimate = {
  lowMicros: 5_000,
  medianMicros: 7_000,
  highMicros: 11_000,
  runs: 0,
  basis: 'guess',
  per: 'run',
  models: [SONNET],
};

function WithCosts({ children }: { children: React.ReactNode }) {
  return (
    <PaidCostsProvider
      costs={{ 'app/learn/e/[id]/actions.ts#rephraseEssaySelection': rephraseCost }}
    >
      {children}
    </PaidCostsProvider>
  );
}

export function LearnEssaySurface() {
  return (
    <WithCosts>
      <EssayView essay={essay} />
    </WithCosts>
  );
}

/** Cmd-S after the note was edited in Obsidian (plan #1866): the save stopped and offers a reload. */
export function LearnEssayChangedSurface() {
  return (
    <EssayView
      essay={essay}
      initialVault={{ kind: 'failed', reason: 'changed', error: ESSAY_VAULT_ERRORS.changed }}
    />
  );
}

/** The brief unfolded above the draft (plan #1867), with an answer long enough to wrap. */
export function LearnEssayBriefSurface() {
  return <EssayView essay={essay} briefOpen />;
}

// The first paragraph, so the suggestion is inside a phone's first screen,
// which is all of the editor CodeMirror draws in a full-page shot.
const OBJECTION =
  'Money is the one good we expect to hold its value while it sits in a drawer, and that expectation is *strange* once you look at it.';
const objectionAt = draft.indexOf(OBJECTION);

/** Rephrase on a sentence of the first paragraph (plan #1868): struck through, Dash's wording after it, Accept and Reject. */
export function LearnEssayRephraseSurface() {
  return (
    <WithCosts>
      <EssayView
        essay={essay}
        initialSuggestion={{
          from: objectionAt,
          to: objectionAt + OBJECTION.length,
          text: 'Money alone we expect to keep its value in a drawer, which is *strange* once you look at it.',
          name: MODELS.learnEssayRephrase,
        }}
      />
    </WithCosts>
  );
}

/** After reloading a note edited elsewhere (plan #1868): keep the marks or clear them. */
export function LearnEssayMarksSurface() {
  return (
    <WithCosts>
      <EssayView essay={essay} initialAskMarks />
    </WithCosts>
  );
}

const goalPin: EssayPin = {
  kind: 'goal',
  id: '00000000-0000-4000-8000-0000000000c1',
  title: 'Understand how central banks set interest rates and why it moves house prices',
};

const blank: Essay = {
  id: '00000000-0000-4000-8000-000000000004',
  path: 'Essays/Untitled essay.md',
  noteId: null,
  blobSha: null,
  draftBody: '',
  marks: [],
  unsaved: false,
  brief: { question: '', claim: '', reader: '', origin: '', change: '', pinned: [goalPin] },
  interview: { status: 'asking', field: 'question', ask: openingAsk([goalPin]) },
  wordTarget: null,
  publishedAt: null,
  updatedAt: '2026-10-12T15:00:00Z',
};

/** "Write about this" on a finished goal: the interview opens naming it (plan #1867). */
export function LearnEssayInterviewSurface() {
  return <EssayView essay={blank} />;
}

/** Three answers in, on the fourth question as Dash worded it. */
export function LearnEssayInterviewLaterSurface() {
  return (
    <EssayView
      essay={{
        ...blank,
        brief: {
          ...blank.brief,
          question:
            'Why does a quarter-point rate rise move house prices more than it moves anything else?',
          claim:
            'Because a house is bought almost entirely with borrowed money, so its price is really a monthly payment.',
          reader: 'My sister, who is buying her first flat next spring',
        },
        interview: {
          status: 'asking',
          field: 'origin',
          ask: 'What did you see that made you think of a house price as a monthly payment rather than a price?',
        },
      }}
    />
  );
}

const finishedUnits: PlanUnit[] = [
  {
    id: 'u1',
    ordinal: 1,
    title: 'What a central bank controls',
    covers: null,
    outcome: null,
    pieces: [
      {
        id: 'p1',
        ordinal: 1,
        title: 'The policy rate and the rates banks charge',
        state: 'passed',
      },
      { id: 'p2', ordinal: 2, title: 'Why a bank cannot set the long rate', state: 'passed' },
    ],
  },
  {
    id: 'u2',
    ordinal: 2,
    title: 'Rates and house prices',
    covers: null,
    outcome: null,
    pieces: [
      { id: 'p3', ordinal: 1, title: 'A house price as a monthly payment', state: 'passed' },
      { id: 'p4', ordinal: 2, title: 'Why supply decides how far prices move', state: 'passed' },
    ],
  },
];

const passedProject: ProjectView = {
  id: 'pr1',
  title: 'Price a flat at three interest rates',
  task: 'Work out what a buyer on a fixed income can pay for a flat at 3%, 4% and 5%, and say what that does to prices.',
  data: null,
  figures: [],
  spreadsheetNote: null,
  worked:
    'At 3% the buyer can borrow about a fifth more than at 5%, and that is the price ceiling.',
  passed: true,
  latest: null,
};

/** A finished learning goal's plan, with "Write about this" (plan #1867). */
export function LearnPlanFinishedSurface() {
  return (
    <PlanSection
      subjectId="00000000-0000-4000-8000-0000000000d1"
      units={finishedUnits}
      project={passedProject}
      goal={{ aimId: goalPin.id, name: goalPin.title }}
    />
  );
}
