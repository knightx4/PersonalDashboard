'use client';

import { PreparationBlock } from '@/app/learn/s/[id]/prepare';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { PreparationRow, PreparationStepRow } from '@/lib/learn/prepare/run';
import { PREPARATION_STEPS, type PreparationStepKey } from '@/lib/learn/prepare/steps';
import { preparationView } from '@/lib/learn/prepare/view';

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

function Page({ children }: { children: React.ReactNode }) {
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
      <h2 className="mb-2 text-ui font-semibold text-ink-muted">Curriculum · 0 of 4 units done</h2>
    </div>
  );
}

/** Partway: three steps done, the fourth being worked, the rest to come. */
export function LearnSubjectPrepareSurface() {
  return (
    <Page>
      <PreparationBlock
        live={false}
        subjectId={SUBJECT_ID}
        view={preparationView(
          prep(
            { currentStep: 'compile_territory' },
            {
              classify: CLASSIFIED,
              pull_documents: PULLED,
              match_weeks: MATCHED,
              compile_territory: { status: 'running', summary: 'Merging the outlines of 4 syllabi into one map.' },
            },
          ),
        )}
      />
    </Page>
  );
}

/** The moment after adding a subject: the run open, the first step marked. */
export function LearnSubjectPrepareStartingSurface() {
  return (
    <Page>
      <PreparationBlock
        live={false}
        subjectId={SUBJECT_ID}
        view={preparationView(prep({ status: 'pending', startedAt: null }, {}))}
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
