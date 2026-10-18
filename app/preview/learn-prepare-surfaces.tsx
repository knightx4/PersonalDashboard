'use client';

import { PreparationBlock } from '@/app/learn/s/[id]/prepare';
import { SourcesSection, StartHere } from '@/app/learn/s/[id]/sources';
import { DirectionOffer } from '@/app/learn/s/[id]/direction';
import { BRANCH_STEPS, type DirectionOffer as DirectionOfferData } from '@/lib/learn/prepare/branch';
import { CurriculumComing } from '@/app/learn/s/[id]/curriculum';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { SubjectReading } from '@/lib/learn/chat/subject-load';
import type { UnbuiltFigure } from '@/lib/learn/figures/needs-load';
import type { FinishDetail } from '@/lib/learn/prepare/finish-step';
import type { PreparationRow, PreparationStepRow } from '@/lib/learn/prepare/run';
import { PREPARATION_STEPS, type PreparationStepKey } from '@/lib/learn/prepare/steps';
import { branchPreparationView, preparationSources, preparationView, unitsComeAtStep } from '@/lib/learn/prepare/view';

/**
 * A subject's preparation on its page (plan #2276.2), drawn at each stage of
 * a run: just started, partway, stopped on a failed step, finished, and a
 * subject made before preparation existed. The fixtures go through
 * preparationView, so the gallery draws what the page would draw from the
 * same rows.
 */

const SUBJECT_ID = '00000000-0000-4000-8000-00000000c276';

type StepFixture = Partial<Omit<PreparationStepRow, 'key' | 'ordinal'>>;

function prep(
  run: Partial<PreparationRow>,
  steps: Partial<Record<PreparationStepKey, StepFixture>>,
): { run: PreparationRow; steps: PreparationStepRow[] } {
  return {
    run: {
      id: '00000000-0000-4000-8000-00000000d276',
      userId: 'u',
      subjectId: SUBJECT_ID,
      status: 'running',
      currentStep: null,
      startedAt: '2026-10-16T09:00:00Z',
      finishedAt: null,
      error: null,
      failures: 0,
      ...run,
    },
    steps: PREPARATION_STEPS.map((key, i) => ({
      key,
      ordinal: i + 1,
      status: 'pending',
      startedAt: null,
      finishedAt: null,
      summary: null,
      counts: {},
      calls: 0,
      error: null,
      ...steps[key],
    })),
  };
}

const CLASSIFIED: StepFixture = {
  status: 'done',
  summary: 'A practitioner subject: learned from how working analysts do it, more than from a course.',
};
const PULLED: StepFixture = {
  status: 'done',
  summary: null,
  counts: { documents: 4 },
};
const MATCHED: StepFixture = { status: 'done', counts: { weeks: 11 } };

function Page({ children, tail }: { children: React.ReactNode; tail?: React.ReactNode }) {
  return (
    <div>
      {/* The subject's note as the page draws it. */}
      <div className={cn(cardVariants({ padding: 'dense' }), 'mb-5')}>
        <p className="border-l-2 border-accent pl-3 text-body text-ink-muted">
          How subscription businesses measure revenue, churn and the cost of winning a customer, well
          enough to read a board deck and argue with it.
        </p>
      </div>
      {children}
      {tail ?? <h2 className="mb-2 text-ui font-semibold text-ink-muted">Curriculum · 0 of 4 units done</h2>}
    </div>
  );
}

const PARTWAY = preparationView(
  prep(
    { currentStep: 'compile_territory' },
    {
      classify: CLASSIFIED,
      pull_documents: PULLED,
      match_weeks: MATCHED,
      compile_territory: { status: 'running', summary: 'Merging the outlines of 4 syllabi into one map.' },
    },
  ),
);
const STARTING = preparationView(prep({ status: 'pending', startedAt: null }, {}));

/** Where the curriculum goes while the run is going: the line the page draws (plan #2276.9). */
function UnitsComing({ view }: { view: ReturnType<typeof preparationView> }) {
  const at = unitsComeAtStep(view);
  return at ? <CurriculumComing {...at} /> : null;
}

/** Partway: three steps done, the fourth being worked, the rest to come. */
export function LearnSubjectPrepareSurface() {
  return (
    <Page tail={<UnitsComing view={PARTWAY} />}>
      <PreparationBlock
        live={false}
        subjectId={SUBJECT_ID}
        view={PARTWAY}
      />
    </Page>
  );
}

/** The moment after adding a subject: the run open, the first step marked. */
export function LearnSubjectPrepareStartingSurface() {
  return (
    <Page tail={<UnitsComing view={STARTING} />}>
      <PreparationBlock
        live={false}
        subjectId={SUBJECT_ID}
        view={STARTING}
      />
    </Page>
  );
}

/** Stopped on a failed step, with the reason and Continue. */
export function LearnSubjectPrepareFailedSurface() {
  return (
    <Page>
      <PreparationBlock
        live={false}
        subjectId={SUBJECT_ID}
        view={preparationView(
          prep(
            { status: 'failed', currentStep: 'draft_topics', error: 'Draft the topics and their checks: the model call timed out' },
            {
              classify: CLASSIFIED,
              pull_documents: PULLED,
              match_weeks: MATCHED,
              compile_territory: { status: 'done', counts: { topics: 34 }, summary: '34 topics in 6 branches, from 4 syllabi and the frame topics.' },
              draft_topics: {
                status: 'failed',
                counts: { topics: 12 },
                error:
                  'The drafting call timed out after 12 of 34 topics. The 12 already drafted are kept, and Continue picks up at the thirteenth.',
              },
            },
          ),
        )}
      />
    </Page>
  );
}

/** Finished: folded to one line. */
export function LearnSubjectPrepareFinishedSurface() {
  return (
    <Page>
      <PreparationBlock
        live={false}
        subjectId={SUBJECT_ID}
        sourcesHref="#sources"
        view={preparationView(
          prep(
            { status: 'done', finishedAt: '2026-10-16T09:07:20Z' },
            {
              classify: CLASSIFIED,
              pull_documents: PULLED,
              match_weeks: MATCHED,
              compile_territory: { status: 'done' },
              draft_topics: { status: 'done', counts: { topics: 31 } },
              write_units: { status: 'done', counts: { units: 4 } },
              finish: { status: 'done', counts: { seconds: 440 }, summary: 'Prepared in 7 minutes.' },
            },
          ),
        )}
      />
    </Page>
  );
}

/** A subject made before preparation existed: the Prepare press. */
export function LearnSubjectPrepareEmptySurface() {
  return (
    <Page>
      <PreparationBlock live={false} subjectId={SUBJECT_ID} view={preparationView(null)} />
    </Page>
  );
}

// Finished: Start here and Sources (plan #2276.6) -------------------------

const START_TOPIC_ID = '00000000-0000-4000-8000-00000000e276';

const FINISH_DETAIL: FinishDetail = {
  start: {
    unit: 'Recurring revenue and how it is counted',
    topic: { id: START_TOPIC_ID, name: 'Monthly recurring revenue', ask: 'monthly recurring revenue' },
  },
  documents: [
    {
      itemId: 'a1',
      title: 'MGT 452: Metrics and Unit Economics for Subscription Businesses, Spring 2025 syllabus',
      provider: 'Open Syllabus',
      url: 'https://example.edu/mgt452',
      licence: 'structure_only',
      rights: 'Copyright of the instructor; structure only',
      units: 14,
      used: true,
    },
    {
      itemId: 'a2',
      title: 'Principles of Accounting, Volume 1: Revenue recognition',
      provider: 'OpenStax',
      url: 'https://openstax.org/books/principles-financial-accounting',
      licence: 'never_feed',
      rights: 'CC BY 4.0; headings only',
      units: 9,
      used: true,
    },
    {
      itemId: 'a3',
      title: 'Software as a service',
      provider: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Software_as_a_service',
      licence: 'show',
      rights: 'CC BY-SA 4.0',
      units: 6,
      used: true,
    },
    {
      itemId: 'a4',
      title: 'Customer acquisition cost',
      provider: 'Wikipedia',
      url: 'https://en.wikipedia.org/wiki/Customer_acquisition_cost',
      licence: 'show',
      rights: 'CC BY-SA 4.0',
      units: 3,
      used: false,
    },
    {
      itemId: 'a5',
      title: 'ECON 310 Industrial Organisation reading list',
      provider: 'Open Syllabus',
      url: 'https://example.edu/econ310',
      licence: 'structure_only',
      rights: null,
      units: 10,
      used: true,
    },
  ],
  frames: ['Revenue recognition', 'Customer lifetime value', 'Unit economics', 'Cohort analysis', 'Pricing strategy'],
};

const READINGS: SubjectReading[] = [
  { id: 'r1', title: 'The SaaS metrics that matter, and the ones that mislead', status: 'reading', why: null, pending: false },
  { id: 'r2', title: 'Why net revenue retention above 100% changes the maths of growth', status: 'queued', why: null, pending: false },
  { id: 'r3', title: 'Bessemer: State of the Cloud 2025', status: 'read', why: null, pending: false },
];

function finishedSources(detail: FinishDetail) {
  const sources = preparationSources(
    prep(
      { status: 'done', finishedAt: '2026-10-16T09:07:20Z' },
      {
        classify: CLASSIFIED,
        pull_documents: { ...PULLED, counts: { documents: detail.documents.length } },
        match_weeks: MATCHED,
        compile_territory: { status: 'done' },
        draft_topics: { status: 'done', counts: { topics: 31 } },
        write_units: { status: 'done', counts: { units: 4 } },
        finish: { status: 'done', counts: { seconds: 440 }, detail },
      },
    ),
  );
  if (!sources) throw new Error('A finished run has sources.');
  return sources;
}

const UNIT = {
  ordinal: 1,
  title: 'Recurring revenue and how it is counted',
  covers: 'What counts as recurring, how monthly and annual figures relate, and where bookings and revenue part ways.',
};

const UNIT_TITLES = [
  'Recurring revenue and how it is counted',
  'Churn, retention and expansion',
  'What a customer costs to win',
  'Reading a board deck',
];

function Curriculum() {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-ui font-semibold text-ink-muted">Curriculum · 0 of 4 units done</h2>
      <ol className={cn(cardVariants(), 'divide-y divide-border')}>
        {UNIT_TITLES.map((title, i) => (
          <li key={title} className="card-pad text-body font-semibold text-ink">
            <span className="mr-1.5 text-ink-muted tabular-nums">{i + 1}.</span>
            {title}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A prepared subject opening on Start here, with every source listed under the curriculum. */
export function LearnSubjectPrepareStartSurface() {
  return (
    <div>
      <StartHere
        unit={UNIT}
        topic={{ id: START_TOPIC_ID, name: 'Monthly recurring revenue', approved: true, cellId: '00000000-0000-4000-8000-00000000f276' }}
        draftedName="Monthly recurring revenue"
        subjectId={SUBJECT_ID}
        lesson={{ pieceId: '00000000-0000-4000-8000-00000000f277', title: 'What counts as recurring revenue, and what does not' }}
      />
      <Curriculum />
      <SourcesSection live={false} subjectId={SUBJECT_ID} sources={finishedSources(FINISH_DETAIL)} readings={READINGS} />
    </div>
  );
}

/** The first unit has no pieces yet: the practice press leads, and the card says the lesson is being written. */
export function LearnSubjectPrepareStartPendingSurface() {
  return (
    <div>
      <StartHere
        unit={UNIT}
        topic={{ id: START_TOPIC_ID, name: 'Monthly recurring revenue', approved: true, cellId: '00000000-0000-4000-8000-00000000f276' }}
        draftedName="Monthly recurring revenue"
        subjectId={SUBJECT_ID}
        lessonPending
      />
      <Curriculum />
    </div>
  );
}

/** No documents stored, and the first topic still a draft. */
export function LearnSubjectPrepareSourcesEmptySurface() {
  return (
    <div>
      <StartHere
        unit={UNIT}
        topic={{ id: START_TOPIC_ID, name: 'Monthly recurring revenue', approved: false, cellId: null }}
        draftedName="Monthly recurring revenue"
      />
      <Curriculum />
      <SourcesSection
        live={false}
        subjectId={SUBJECT_ID}
        sources={finishedSources({ ...FINISH_DETAIL, documents: [] })}
        readings={[]}
      />
    </div>
  );
}

/** A later visit, once the section has been read: folded to its count. */
export function LearnSubjectPrepareSourcesFoldedSurface() {
  return (
    <div>
      <StartHere
        unit={UNIT}
        topic={{ id: START_TOPIC_ID, name: 'Monthly recurring revenue', approved: true, cellId: '00000000-0000-4000-8000-00000000f276' }}
        draftedName="Monthly recurring revenue"
      />
      <Curriculum />
      <SourcesSection
        live={false}
        defaultOpen={false}
        subjectId={SUBJECT_ID}
        sources={finishedSources(FINISH_DETAIL)}
        readings={READINGS}
      />
    </div>
  );
}

// Figures its lessons asked for (plan #2321.12) -----------------------------

const UNBUILT: UnbuiltFigure[] = [
  {
    key: '00000000-0000-4000-8000-00000000f301',
    need: 'data_source',
    shows: 'Monthly recurring revenue of a public software company across its last twelve quarters, from its filings',
    why: 'The lesson compares two companies and the app holds no filings.',
    asked: 4,
  },
  {
    key: '00000000-0000-4000-8000-00000000f302',
    need: 'model',
    shows: 'How a change in monthly churn moves the lifetime value of a customer, with the churn rate adjustable',
    why: 'The lesson asks the reader to try rates.',
    asked: 1,
  },
];

/** The Sources section listing the figures the subject's lessons wanted and did not get. */
export function LearnSubjectSourcesUnbuiltSurface() {
  return (
    <SourcesSection
      live={false}
      subjectId={SUBJECT_ID}
      sources={finishedSources(FINISH_DETAIL)}
      readings={READINGS}
      unbuilt={UNBUILT}
    />
  );
}

/** Nothing outstanding: the section draws as it did before the list existed. */
export function LearnSubjectSourcesUnbuiltNoneSurface() {
  return (
    <SourcesSection
      live={false}
      subjectId={SUBJECT_ID}
      sources={finishedSources(FINISH_DETAIL)}
      readings={READINGS}
      unbuilt={[]}
    />
  );
}

// Going deeper (plan #2276.7) ------------------------------------------------

const BRANCH_OFFER: DirectionOfferData = {
  answers: 34,
  branches: [
    {
      key: 'customer-retention-and-the-economics-of-churn-in-subscription-businesses',
      frame: 'Customer retention and the economics of churn in subscription businesses',
      name: 'Customer retention and the economics of churn in subscription businesses',
      asks: [],
      topics: 9,
      leadsTo: ['Gross revenue churn', 'Net revenue retention', 'Cohort retention curves'],
    },
    {
      key: 'unit-economics',
      frame: 'Unit economics',
      name: 'Unit economics',
      asks: [],
      topics: 7,
      leadsTo: ['Customer acquisition cost', 'Payback period', 'LTV to CAC ratio'],
    },
    {
      key: 'revenue-recognition',
      frame: 'Revenue recognition',
      name: 'Revenue recognition',
      asks: [],
      topics: 4,
      leadsTo: ['Deferred revenue', 'Bookings against billings', 'ASC 606 for subscriptions'],
    },
  ],
};

/** Past thirty graded answers: the offer under Start here, three branches to pick from. */
export function LearnSubjectPrepareDirectionSurface() {
  return (
    <Page>
      <StartHere
        unit={UNIT}
        topic={{ id: START_TOPIC_ID, name: 'Monthly recurring revenue', approved: true, cellId: '00000000-0000-4000-8000-00000000f276' }}
        draftedName="Monthly recurring revenue"
      />
      <DirectionOffer live={false} subjectId={SUBJECT_ID} offer={BRANCH_OFFER} />
    </Page>
  );
}

function branchSteps(steps: Partial<Record<PreparationStepKey, StepFixture>>): PreparationStepRow[] {
  return prep({}, steps).steps.filter((s) => BRANCH_STEPS.includes(s.key));
}

/** A branch picked: its five steps running on the page, an earlier branch folded to its line. */
export function LearnSubjectPrepareBranchSurface() {
  const earlier = branchPreparationView({
    run: {
      ...prep({}, {}).run,
      status: 'done',
      startedAt: '2026-10-12T09:00:00Z',
      finishedAt: '2026-10-12T09:07:00Z',
      branch: { key: 'revenue-recognition', frame: 'Revenue recognition', name: 'Revenue recognition', asks: [] },
    },
    steps: branchSteps({
      pull_documents: { status: 'done', counts: { documents: 2 } },
      match_weeks: { status: 'done', counts: { weeks: 6 } },
      compile_territory: { status: 'done' },
      draft_topics: { status: 'done', counts: { drafted: 11 } },
      finish: { status: 'done' },
    }),
  });
  const working = branchPreparationView({
    run: {
      ...prep({}, {}).run,
      currentStep: 'draft_topics',
      branch: { key: 'unit-economics', frame: 'Unit economics', name: 'Unit economics', asks: [] },
    },
    steps: branchSteps({
      pull_documents: { status: 'done', summary: 'Stored 3 documents from 2 sources.' },
      match_weeks: { status: 'done', summary: 'Found 9 weeks that cover it, across 3 documents.' },
      compile_territory: { status: 'done', summary: 'Laid out 14 topics from 3 documents: 5 canonical, 7 practitioner, 2 personal.' },
      draft_topics: { status: 'running', summary: '6 of 14 topics drafted; carrying on in a fresh call.' },
    }),
  });
  return (
    <Page>
      {earlier && (
        <PreparationBlock live={false} subjectId={SUBJECT_ID} view={earlier.view} branch={{ key: earlier.key, name: earlier.name }} />
      )}
      {working && (
        <PreparationBlock live={false} subjectId={SUBJECT_ID} view={working.view} branch={{ key: working.key, name: working.name }} />
      )}
    </Page>
  );
}
