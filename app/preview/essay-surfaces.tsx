import { sectionSubject } from '@/lib/core/section-path';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { HAIKU, MODELS, SONNET } from '@/lib/core/models';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import { EssaysView } from '@/app/learn/essays/essays-view';
import { EssayView } from '@/app/learn/e/[id]/essay-view';
import { PlanSection } from '@/app/learn/s/[id]/plan';
import { ChatLearningSection } from '@/app/learn/s/[id]/chat-learning';
import { openingAsk } from '@/lib/learn/essays/interview';
import type { Essay, EssayPin, EssaySummary } from '@/lib/learn/essays/model';
import { EMPTY_PLAN } from '@/lib/learn/essays/plan';
import type { NoteMap } from '@/lib/learn/essays/notebook';
import type { PlanUnit } from '@/lib/learn/lessons/plan-view';
import type { ProjectView } from '@/lib/learn/lessons/project';
import { ESSAY_VAULT_ERRORS } from '@/lib/learn/essays/vault';
import { makeAnchor } from '@/lib/learn/essays/anchor';
import type { EssayNote, EssayNotes } from '@/lib/learn/essays/notes-store';
import type { StudyItem } from '@/lib/learn/essays/study';
import type { EssayResearch } from '@/lib/learn/essays/research';
import type { StudyState } from '@/app/learn/e/[id]/essay-study';
import type { MergeDialogState } from '@/app/learn/e/[id]/merge-note-dialog';
import { joinNotes } from '@/lib/learn/essays/join-notes';
import { NOTES_TO_VAULT_ERRORS } from '@/lib/learn/essays/notes-to-vault';
import type { VaultNoteMatch } from '@/lib/learn/essays/vault-notes';

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
  finishedAt: null,
  inEvidenceBank: false,
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

/** About what one paragraph's check costs, as the Learn layout would give it. */
const checkCost: CostEstimate = {
  ...rephraseCost,
  per: 'unit',
  lowMicros: 9_000,
  medianMicros: 12_000,
  highMicros: 18_000,
};

/** About what one study search costs: one small embedding, often cached. */
const studyCost: CostEstimate = {
  lowMicros: 0,
  medianMicros: 6,
  highMicros: 20,
  runs: 0,
  basis: 'guess',
  per: 'run',
  models: ['voyage-4-lite'],
};

/** A first research pass: four searches on Haiku, as the guess prices it (plan #1863.9). */
const firstPassCost: CostEstimate = {
  lowMicros: 54_000,
  medianMicros: 107_500,
  highMicros: 215_000,
  runs: 0,
  basis: 'guess',
  per: 'run',
  models: [HAIKU],
};

/** A deeper pass: Haiku gathering pages and Sonnet marking the claims. */
const deeperPassCost: CostEstimate = {
  lowMicros: 145_000,
  medianMicros: 290_000,
  highMicros: 580_000,
  runs: 0,
  basis: 'guess',
  per: 'run',
  models: [HAIKU, SONNET],
};

/** Finishing: one Sonnet call naming the claims, and an embedding for each (plan #1873). */
const finishCost: CostEstimate = {
  lowMicros: 9_000,
  medianMicros: 14_000,
  highMicros: 24_000,
  runs: 0,
  basis: 'guess',
  per: 'run',
  models: [SONNET, 'voyage-4-lite'],
};

function WithCosts({ children }: { children: React.ReactNode }) {
  return (
    <PaidCostsProvider
      costs={{
        'app/learn/e/[id]/actions.ts#rephraseEssaySelection': rephraseCost,
        'app/learn/e/[id]/actions.ts#runEssayCheck:model': checkCost,
        'app/learn/e/[id]/actions.ts#runEssayCheck:already-said': checkCost,
        'app/learn/e/[id]/actions.ts#findEssayStudy': studyCost,
        'app/learn/e/[id]/actions.ts#researchEssay:first': firstPassCost,
        'app/learn/e/[id]/actions.ts#researchEssay:deeper': deeperPassCost,
        'app/learn/e/[id]/actions.ts#finishEssay': finishCost,
      }}
    >
      {children}
    </PaidCostsProvider>
  );
}

/** The panel before anything is searched; the gallery never searches. */
const STUDY_WAITING: StudyState = { kind: 'waiting' };

/**
 * What the study panel finds for the first paragraph (plan #1863.8): the
 * pinned reading first, then a passage from a note, a position from the
 * vault map with its checked quote, a learning-log entry and a card note.
 */
const studyItems: StudyItem[] = [
  {
    key: 'reading:00000000-0000-4000-8000-0000000000b1',
    kind: 'reading',
    title: 'Walzer - Spheres of Justice ch4',
    context: 'Chapter 4, pages 95 to 103',
    sentence:
      'Money is the universal pander, and it slips across every boundary the other spheres draw.',
    href: '/learn/r/00000000-0000-4000-8000-0000000000b1',
    link: null,
    pinned: true,
  },
  {
    key: 'passage:00000000-0000-4000-8000-0000000000e1:Why cash loses value',
    kind: 'passage',
    title:
      'Inflation, savings and the strange patience of people who keep cash in a drawer for decades',
    context: 'Economics › Why cash loses value',
    sentence:
      'A pound in a drawer loses about two pence a year, and almost nobody notices because nothing else they own keeps its value either.',
    href: '/vault/notes/Economics/Inflation%20and%20savings.md',
    link: 'Inflation and savings',
    pinned: false,
  },
  {
    key: 'position:00000000-0000-4000-8000-0000000000e2',
    kind: 'position',
    title: 'Money is a claim, not a thing',
    context: 'Money keeps its value only while other people will take it in exchange.',
    sentence: 'What we hold is a promise that someone else will want it tomorrow.',
    href: '/vault/map/00000000-0000-4000-8000-0000000000e3',
    link: 'Notes on Graeber',
    pinned: false,
  },
  {
    key: 'log:00000000-0000-4000-8000-0000000000e4',
    kind: 'log',
    title: 'Hyperinflation in Weimar Germany',
    context: null,
    sentence:
      'Once prices doubled every few days, people spent wages within the hour rather than hold marks overnight.',
    href: '/learn/s/00000000-0000-4000-8000-0000000000e5',
    link: null,
    pinned: false,
  },
  {
    key: 'card:00000000-0000-4000-8000-0000000000e6',
    kind: 'card',
    title: 'Your note on Store of value',
    context: null,
    sentence:
      'Bread spoils, coats wear thin, and money is the thing we use to carry value across the gap.',
    href: '/learn/c/00000000-0000-4000-8000-0000000000e7',
    link: null,
    pinned: false,
  },
];

const STUDY_FOUND: StudyState = { kind: 'found', items: studyItems, searched: true, indexed: true };

export function LearnEssaySurface() {
  return (
    <WithCosts>
      <EssayView
        initialView="draft"
        essay={essay}
        study={STUDY_FOUND}
        path={sectionSubject('/learn/essays', 'Essays', {
          label: 'Why money is the odd good out',
          href: `/learn/e/${essay.id}`,
        })}
      />
    </WithCosts>
  );
}

/**
 * Research on the essay (plan #1863.9): a first pass with four positions on
 * the question, and a deeper pass with the draft's claims marked against the
 * pages read, one of them mixed and one no page spoke to. The pages are
 * invented, under example domains.
 */
const firstPass: EssayResearch = {
  id: '00000000-0000-4000-8000-0000000000d1',
  level: 'first',
  question: essay.brief.question,
  queries: [
    'why money holds its value',
    'money as a store of value history',
    'gold store of value without exchange',
    'hyperinflation demand for money collapse',
  ],
  sources: [
    {
      url: 'https://history.example.org/money-and-trust',
      title: 'Money and trust: a short history',
      domain: 'history.example.org',
      text: null,
    },
    {
      url: 'https://econbrief.example.com/store-of-value',
      title: 'What makes a store of value?',
      domain: 'econbrief.example.com',
      text: null,
    },
    {
      url: 'https://goldreview.example.net/centuries',
      title: 'Gold across five centuries of prices',
      domain: 'goldreview.example.net',
      text: null,
    },
    {
      url: 'https://history.example.org/weimar',
      title: 'The Weimar inflation, week by week',
      domain: 'history.example.org',
      text: null,
    },
  ],
  positions: [
    {
      title: 'Money keeps its value because everyone expects everyone else to accept it.',
      summary:
        'Historians of money describe its value as a shared expectation rather than a property of the coin or note, which is why it can vanish quickly.',
      citations: [
        { source: 0, quote: 'A coin is worth what the next person will give for it, and no more' },
        {
          source: 3,
          quote: 'by November 1923 shopkeepers refused marks that had been good in the morning',
        },
      ],
    },
    {
      title: 'Money holds value only as long as its supply is kept scarce.',
      summary:
        'Economists who stress supply point to central banks and the fixed stock of gold as what stops money wearing out.',
      citations: [
        {
          source: 1,
          quote:
            'a store of value must be costly to produce more of, or its holders will be diluted',
        },
      ],
    },
    {
      title: 'Gold shows a good can hold value for centuries without being money for everything.',
      summary:
        'Price series for gold suggest it kept its purchasing power over long periods even where it was not used to buy ordinary goods.',
      citations: [
        {
          source: 2,
          quote: 'an ounce bought roughly the same quantity of bread in 1600 as in 1900',
        },
      ],
    },
  ],
  claims: [],
  summary:
    'Most writers on money say its value is a shared expectation: a coin is worth what the next person will give for it. Others put the weight on scarcity, and point to central banks and the fixed stock of gold. A [price series for gold](https://goldreview.example.net/centuries) is the awkward case, since gold kept its value for centuries without being used to buy everyday goods.',
  asks: [
    'If money is only a shared expectation, what is the difference between it and gold in your essay?',
    'Which of the Weimar examples would your reader find most convincing, and why?',
  ],
  costMicros: 64_000,
  createdAt: '2026-10-12T14:40:00Z',
};

const deeperPass: EssayResearch = {
  id: '00000000-0000-4000-8000-0000000000d2',
  level: 'deeper',
  question: essay.brief.question,
  queries: [
    'money spheres Walzer criticism',
    'gold purchasing power long run',
    'hyperinflation flight from money',
  ],
  sources: [
    {
      url: 'https://philosophy.example.org/walzer-spheres',
      title: 'Walzer’s spheres of justice, explained',
      domain: 'philosophy.example.org',
      text: null,
    },
    {
      url: 'https://goldreview.example.net/centuries',
      title: 'Gold across five centuries of prices',
      domain: 'goldreview.example.net',
      text: null,
    },
    {
      url: 'https://history.example.org/weimar',
      title: 'The Weimar inflation, week by week',
      domain: 'history.example.org',
      text: null,
    },
  ],
  positions: [],
  claims: [
    {
      claim: 'Money is the one good expected to hold its value while it sits unused.',
      verdict: 'mixed',
      supporting: 1,
      opposing: 1,
      citations: [
        {
          source: 0,
          quote: 'money alone among goods is wanted for what it can become',
          stance: 'for',
        },
        {
          source: 1,
          quote: 'gold, land and fine wine have each kept value over long periods without use',
          stance: 'against',
        },
      ],
    },
    {
      claim: 'When money cannot turn into other goods, nobody wants to hold it.',
      verdict: 'supported',
      supporting: 1,
      opposing: 0,
      citations: [
        {
          source: 2,
          quote: 'wages were spent within the hour, before the next price list went up',
          stance: 'for',
        },
      ],
    },
    {
      claim: 'Walzer calls money the universal pander.',
      verdict: 'unsourced',
      supporting: 0,
      opposing: 0,
      citations: [],
    },
  ],
  summary: '',
  asks: [],
  costMicros: 238_000,
  createdAt: '2026-10-12T14:55:00Z',
};

/** Both passes run, their positions and claims under their buttons. */
export function LearnEssayResearchSurface() {
  return (
    <WithCosts>
      <EssayView
        initialView="draft"
        essay={essay}
        study={STUDY_WAITING}
        research={{ first: firstPass, deeper: deeperPass }}
      />
    </WithCosts>
  );
}

/**
 * Nothing close enough yet, while the vault is still being split into
 * passages (plan #1863.8): the panel says so rather than looking broken.
 */
export function LearnEssayStudyEmptySurface() {
  return (
    <WithCosts>
      <EssayView
        initialView="draft"
        essay={{ ...essay, brief: { ...essay.brief, pinned: [] } }}
        study={{ kind: 'found', items: [], searched: true, indexed: false }}
      />
    </WithCosts>
  );
}

/**
 * After Finish (plan #1873): the essay's claims, one of them already held by
 * a note in the vault, with a note offered for each of the others and a place
 * in the evidence bank. The last claim is long, as a model's can be.
 */
export function LearnEssayFinishSurface() {
  return (
    <WithCosts>
      <EssayView
        initialView="draft"
        essay={{ ...essay, finishedAt: '2026-10-12T15:00:00Z', unsaved: false }}
        study={STUDY_WAITING}
        finishStage="seedling"
        finishView={{
          kind: 'offers',
          inEvidenceBank: false,
          claims: [
            {
              name: 'Money is a shared expectation',
              claim:
                'Money keeps its value in a drawer only because everyone expects others to accept it later.',
              existing: null,
            },
            {
              name: 'Scarcity alone does not make money',
              claim:
                'Gold and bitcoin are scarce, but what makes them money is that people agree to take them in payment.',
              existing: {
                title: 'Medium of exchange',
                href: '/vault/n/Concepts/Medium%20of%20exchange.md',
              },
            },
            {
              name: 'Inflation is the price of holding the expectation',
              claim:
                'When people stop expecting money to hold its value, they spend it faster, which raises prices and confirms the fear that started it, so the expectation is something a central bank has to keep managing rather than a fact about money.',
              existing: null,
            },
          ],
        }}
      />
    </WithCosts>
  );
}

/**
 * A published essay (plan #1863.11): on the site since its first publish,
 * published again a day later, with the longest web address a slug gets.
 */
export function LearnEssayPublishSurface() {
  return (
    <WithCosts>
      <EssayView
        initialView="draft"
        essay={{
          ...essay,
          finishedAt: '2026-10-12T15:00:00Z',
          unsaved: false,
          publishedAt: '2026-10-13T09:30:00Z',
          firstPublishedAt: '2026-10-12T15:10:00Z',
          slug: 'money-holds-value-only-because-can-become-every-other-good',
        }}
        study={STUDY_WAITING}
      />
    </WithCosts>
  );
}

/** Cmd-S after the note was edited in Obsidian (plan #1866): the save stopped and offers a reload. */
export function LearnEssayChangedSurface() {
  return (
    <EssayView
      initialView="draft"
      essay={essay}
      initialVault={{ kind: 'failed', reason: 'changed', error: ESSAY_VAULT_ERRORS.changed }}
      study={STUDY_WAITING}
    />
  );
}

/** The brief unfolded above the draft (plan #1867), with an answer long enough to wrap. */
export function LearnEssayBriefSurface() {
  return <EssayView initialView="draft" essay={essay} briefOpen study={STUDY_WAITING} />;
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
        initialView="draft"
        essay={essay}
        initialSuggestion={{
          from: objectionAt,
          to: objectionAt + OBJECTION.length,
          text: 'Money alone we expect to keep its value in a drawer, which is *strange* once you look at it.',
          name: MODELS.learnEssayRephrase,
        }}
        study={STUDY_WAITING}
      />
    </WithCosts>
  );
}

/** A note on a sentence of the first paragraph, so a phone's first screen shows its marker. */
function noteOn(
  id: string,
  checkName: string,
  quote: string,
  rung: number,
  ladder: [string, string, string],
  status: EssayNote['status'] = 'open',
): EssayNote {
  const at = draft.indexOf(quote);
  return {
    id,
    checkName,
    rung,
    body: rung === 0 ? '' : ladder[Math.min(rung, 3) - 1],
    ladder,
    why: 'Counterpoint looks for the strongest objection a reader who disagrees would raise, which the essay does not answer.',
    status,
    anchor:
      at >= 0
        ? makeAnchor(draft, at, at + quote.length)
        : { quote, prefix: '', suffix: '', offset: null },
    createdAt: `2026-10-12T14:0${id.slice(-1)}:00Z`,
  };
}

const COUNTERPOINT_ID = '00000000-0000-4000-8000-0000000000d1';

const essayNotes: EssayNotes = {
  notes: [
    noteOn(COUNTERPOINT_ID, 'counterpoint', 'A loaf is worth less on Thursday than on Monday.', 2, [
      'What would someone who disagrees say about the loaf?',
      'Flour and tinned food keep for years; the essay rests on goods that spoil, and a reader will think of ones that do not.',
      'Narrow the claim to goods you use up, or answer the tinned-food case in a sentence.',
    ]),
    noteOn(
      '00000000-0000-4000-8000-0000000000d2',
      'the_claim',
      'Every good you buy wears out, gets eaten or goes out of fashion.',
      1,
      [
        'Is this the claim you set out to argue, or the ground for it?',
        'The brief claims money holds value because it can become every other good; the opening argues that goods wear out.',
        'Say the brief\u2019s claim in the first paragraph, or change the brief to match what the essay argues.',
      ],
    ),
    noteOn(
      '00000000-0000-4000-8000-0000000000d3',
      'writing_guide',
      'A coat is worth less after a winter.',
      0,
      [
        'Would one example do the work of two?',
        'Two short examples in a row read as a list.',
        'Keep the loaf or the coat.',
      ],
    ),
    noteOn(
      '00000000-0000-4000-8000-0000000000d4',
      'missing_step',
      'Bread goes to the hungry, offices to the qualified.',
      1,
      ['q', 'h', 'd'],
      'waiting',
    ),
    noteOn(
      '00000000-0000-4000-8000-0000000000d5',
      'fact_to_verify',
      'Gold held its value for exactly four thousand years.',
      1,
      ['Where does that figure come from?', 'h', 'd'],
      'detached',
    ),
  ],
  stopped: ['so_what'],
};

/** Checks and the margin notes they raised (plan #1869): three open, one waiting, one detached. */
export function LearnEssayNotesSurface() {
  return (
    <WithCosts>
      <EssayView
        initialView="draft"
        essay={essay}
        notes={essayNotes}
        initialNoteOpen={COUNTERPOINT_ID}
        study={STUDY_WAITING}
      />
    </WithCosts>
  );
}

/** After reloading a note edited elsewhere (plan #1868): keep the marks or clear them. */
export function LearnEssayMarksSurface() {
  return (
    <WithCosts>
      <EssayView initialView="draft" essay={essay} initialAskMarks study={STUDY_WAITING} />
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
  finishedAt: null,
  inEvidenceBank: false,
  updatedAt: '2026-10-12T15:00:00Z',
};

/** "Write about this" on a finished goal: a new essay opens on an empty notes page. */
export function LearnEssayInterviewSurface() {
  return <EssayView essay={blank} initialView="notes" planFrozen study={STUDY_WAITING} />;
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

const midUnits: PlanUnit[] = [
  finishedUnits[0]!,
  {
    id: 'u2',
    ordinal: 2,
    title: 'Why land near a city centre costs so much more than land at its edge',
    covers: null,
    outcome: 'Say what a bid-rent curve is and why it slopes down from the centre.',
    pieces: [
      { id: 'p3', ordinal: 1, title: 'A bid-rent curve for one household', state: 'passed' },
      { id: 'p4', ordinal: 2, title: 'Why offices outbid homes at the centre', state: 'practice' },
      { id: 'p5', ordinal: 3, title: 'What the curve says about commuting costs', state: 'open' },
    ],
  },
  { id: 'u3', ordinal: 3, title: 'Zoning and the supply of floor space', covers: null, outcome: null, pieces: [] },
];

/** A subject's plan part-way: the next unit's pieces open, the finished one folded, a unit not yet written (plan #2307.2). */
export function LearnSubjectPlanSurface() {
  return (
    <PlanSection
      subjectId="00000000-0000-4000-8000-0000000000d1"
      units={midUnits}
      project={passedProject}
      goal={{ aimId: null, name: 'Urban economics' }}
    />
  );
}

/** A subject's logged conversations, each with "Write about this" (plan #1882). */
export function LearnSubjectConversationsSurface() {
  return (
    <ChatLearningSection
      timezone="Europe/London"
      conversationsOpen
      learning={{
        readings: [],
        sessions: [
          {
            id: '00000000-0000-4000-8000-0000000000a1',
            topic:
              'Why a rent cap helps the people already housed and does little for anyone still looking',
            summary:
              'You worked through who a cap protects, why landlords stop listing in capped areas, and what the listings data from your own city shows.',
            ideas: ['Rent control', 'Supply elasticity', 'Insider-outsider markets'],
            createdAt: '2026-10-09T18:20:00Z',
          },
          {
            id: '00000000-0000-4000-8000-0000000000a2',
            topic: 'Mortgage rates',
            summary: 'A short chat on how a point of interest changes the price a buyer can reach.',
            ideas: [],
            createdAt: '2026-10-02T09:05:00Z',
          },
        ],
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Notes first (LEARN-ESSAYS-SPEC, "Notes first")
// ---------------------------------------------------------------------------

const houseNotes = `Rate rises move house prices more than anything else because a house is bought almost entirely with borrowed money.

The agent never asked what we could pay for the flat, only what we could pay each month.

So the price is really a monthly payment. Buyers and agents talk about what they can afford each month, and a rate rise changes that number for everyone at once.

Every lender reprices new loans within weeks, and everyone buying is a new loan.

But cash buyers pay the same price. Maybe because they are bidding against borrowers?

Prices kept rising in 2021 even as rates went up, at least where we live. Not sure how that fits.

Who is this for: my sister, buying her first flat next spring. She should look at the payment, not the asking price.`;

const houseMap: NoteMap = {
  at: '2026-10-12T15:10:00Z',
  claims: [
    'So the price is really a monthly payment.',
    'Rate rises move house prices more than anything else because a house is bought almost entirely with borrowed money.',
  ],
  clusters: [
    {
      id: 'c1',
      label: 'Buyers think in monthly payments',
      quotes: [
        'The agent never asked what we could pay for the flat, only what we could pay each month.',
        'Buyers and agents talk about what they can afford each month',
      ],
      support: 'thin',
      gap: 'One anecdote; nothing shows this is how most buyers set a budget.',
    },
    {
      id: 'c2',
      label: 'A rate rise hits every buyer at once',
      quotes: ['Every lender reprices new loans within weeks, and everyone buying is a new loan.'],
      support: 'none',
      gap: 'No figure for how fast lenders reprice, or by how much.',
    },
    {
      id: 'c3',
      label: 'Cash buyers follow the borrowers',
      quotes: [
        'But cash buyers pay the same price. Maybe because they are bidding against borrowers?',
      ],
      support: 'none',
      gap: 'Still a question in your notes.',
    },
    {
      id: 'c4',
      label: 'What your sister should do',
      quotes: ['She should look at the payment, not the asking price.'],
      support: 'ok',
      gap: '',
    },
  ],
  tensions: [
    {
      a: 'a rate rise changes that number for everyone at once.',
      b: 'Prices kept rising in 2021 even as rates went up, at least where we live.',
      note: 'If rates set the price, rising prices through rate rises need explaining.',
    },
  ],
  questions: [
    'What happened in 2021 that kept prices rising where you live while rates went up?',
    'Is the essay telling your sister what prices will do, or how to judge the price she pays?',
  ],
  ordered: true,
};

const notesEssay: Essay = {
  ...blank,
  id: '00000000-0000-4000-8000-000000000005',
  brief: {
    ...blank.brief,
    question:
      'Why does a quarter-point rate rise move house prices more than it moves anything else?',
    reader: 'My sister, who is buying her first flat next spring',
  },
  interview: { status: 'skipped' },
  wordTarget: 800,
  plan: {
    ...EMPTY_PLAN,
    notes: houseNotes,
    noteMap: houseMap,
    found: [
      {
        label: 'A rate rise hits every buyer at once',
        items: [
          {
            id: 'f1',
            kind: 'rule',
            sourceType: 'regulator',
            title: 'Lenders must test affordability at a higher rate',
            summary:
              'The regulator’s mortgage rules require lenders to check a borrower could still pay if rates rose.',
            quote:
              'assess whether the borrower could afford the payments if interest rates were to rise',
            url: 'https://regulator.example.gov/mortgage-rules',
            sourceTitle: 'Mortgage conduct rules',
            domain: 'regulator.example.gov',
            take: '',
          },
        ],
      },
    ],
    modelDraft: {
      text: `My sister will hear one number at every viewing, and it is not the price.\n\nAgents ask what buyers can pay each month, because almost every buyer borrows. That makes the monthly payment the real price of a home, and the rate on the loan sets it. [gap: how fast lenders pass on a rate rise]\n\nCash buyers might seem to break this, but they bid against borrowers, so they pay what borrowers can afford.`,
      at: '2026-10-12T15:30:00Z',
    },
  },
};

/** The notes page with Dash’s map beside it: claims, threads with their gaps, a tension, two questions, a source found. */
export function LearnEssayNotesMapSurface() {
  return (
    <WithCosts>
      <EssayView essay={notesEssay} initialView="notes" planFrozen study={STUDY_WAITING} />
    </WithCosts>
  );
}

/** The draft view of the same essay, empty, with Assemble and the model draft beside it. */
export function LearnEssayDraftFromNotesSurface() {
  return (
    <WithCosts>
      <EssayView essay={notesEssay} initialView="draft" planFrozen study={STUDY_WAITING} />
    </WithCosts>
  );
}

/**
 * Merge with a vault note, on Prepare (plan #2357.5): the dialog open over the
 * notes essay in each of its states. The vault notes are invented; one has no
 * title, so it shows by its path, and one has the longest title a note gets.
 */
const mergeMatches: VaultNoteMatch[] = [
  {
    id: '00000000-0000-4000-8000-0000000000e1',
    path: 'Economics/Mortgages and the monthly payment.md',
    title: 'Mortgages and the monthly payment',
  },
  { id: '00000000-0000-4000-8000-0000000000e2', path: 'Inbox/2026-09-30 mortgage call.md', title: '' },
  {
    id: '00000000-0000-4000-8000-0000000000e3',
    path: 'Reading/How a rate decision travels from the Monetary Policy Committee to a fixed-rate remortgage.md',
    title: 'How a rate decision travels from the Monetary Policy Committee to a fixed-rate remortgage',
  },
  {
    id: '00000000-0000-4000-8000-0000000000e4',
    path: 'Economics/Mortgage brokers.md',
    title: 'Mortgage brokers',
  },
];

const mortgageNote = `A two-year fix ends and the payment resets to whatever the rate is then. Most of the people we know remortgaged in 2023, all within about a year of each other.

The broker said lenders cap what you borrow at about four and a half times income, but the stress test at a higher rate is what actually decides it.`;

const vaultNoteText = `# Mortgages and the monthly payment

${mortgageNote}`;

const intoNotes: MergeDialogState = {
  query: 'mort',
  search: { kind: 'found', notes: mergeMatches },
  picked: mergeMatches[0]!,
  direction: 'into-notes',
  preview: {
    kind: 'ready',
    before: houseNotes,
    after: joinNotes(houseNotes, mortgageNote, mergeMatches[0]!.title, '2026-10-18'),
    unchanged: false,
    blobSha: null,
  },
  saving: false,
  error: null,
};

const intoVault: MergeDialogState = {
  ...intoNotes,
  direction: 'into-vault',
  preview: {
    kind: 'ready',
    before: vaultNoteText,
    after: joinNotes(vaultNoteText, houseNotes, 'Why rate rises move house prices', '2026-10-18'),
    unchanged: false,
    blobSha: 'a1b2c3',
  },
  error: NOTES_TO_VAULT_ERRORS['read-only'],
};

function MergeSurface({ state }: { state: MergeDialogState }) {
  return (
    <WithCosts>
      <EssayView essay={notesEssay} initialView="prepare" planFrozen study={STUDY_WAITING} mergeView={state} />
    </WithCosts>
  );
}

/** The dialog open on a search with matches. */
export function LearnEssayMergeSurface() {
  return <MergeSurface state={{ ...intoNotes, picked: null, preview: null }} />;
}

/** A search that matches nothing. */
export function LearnEssayMergeEmptySurface() {
  return (
    <MergeSurface
      state={{ ...intoNotes, query: 'zoning', search: { kind: 'found', notes: [] }, picked: null, preview: null }}
    />
  );
}

/** Searching. */
export function LearnEssayMergeLoadingSurface() {
  return <MergeSurface state={{ ...intoNotes, search: { kind: 'searching' }, picked: null, preview: null }} />;
}

/** A note picked: what goes into the notes, and where. */
export function LearnEssayMergePreviewSurface() {
  return <MergeSurface state={intoNotes} />;
}

/** Adding the note to the notes. */
export function LearnEssayMergeSavingSurface() {
  return <MergeSurface state={{ ...intoNotes, saving: true }} />;
}

/** The other way, into the vault note, refused because the vault token cannot write. */
export function LearnEssayMergeErrorSurface() {
  return <MergeSurface state={intoVault} />;
}
