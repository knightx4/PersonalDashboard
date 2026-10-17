'use client';

import { AddSource } from '@/app/learn/s/[id]/add-source';
import { SourcesSection } from '@/app/learn/s/[id]/sources';
import type { SourceDocument } from '@/lib/learn/prepare/finish-step';
import { withAddedSources, type PreparationSources } from '@/lib/learn/prepare/view';

/**
 * Add a source on a subject's page (plan #2307.4), under the Sources section:
 * the press closed with a document it added listed, the box open, the line
 * while it fetches, and the line when the fetch fails. The list goes through
 * withAddedSources, as the page's does.
 */

const SUBJECT_ID = '00000000-0000-4000-8000-00000000c274';

const PREPARED: PreparationSources = {
  summary: 'Prepared in 7 minutes: 2 documents, 31 topics, 4 opening units.',
  start: { unit: null, topic: null },
  documents: [
    {
      itemId: '00000000-0000-4000-8000-00000000a271',
      title: 'Financial Accounting for SaaS Businesses: Revenue, Retention and the Metrics Boards Ask About',
      provider: 'MIT OpenCourseWare',
      url: 'https://ocw.mit.edu/courses/15-501-introduction-to-financial-and-managerial-accounting-spring-2004/',
      licence: 'show',
      rights: 'CC BY-NC-SA 4.0',
      units: 24,
      used: true,
    },
    {
      itemId: '00000000-0000-4000-8000-00000000a272',
      title: 'ECON 310: Industrial Organisation of Software Markets',
      provider: 'Open Syllabus',
      url: 'https://example.edu/econ310',
      licence: 'structure_only',
      rights: null,
      units: 10,
      used: true,
    },
  ],
  frames: ['Revenue recognition', 'Customer lifetime value', 'Unit economics'],
};

const ADDED: SourceDocument = {
  itemId: '00000000-0000-4000-8000-00000000a273',
  title: 'SaaS Metrics 2.0: A Guide to Measuring and Improving What Matters',
  provider: 'Web page',
  url: 'https://www.example.com/saas-metrics-2/',
  licence: 'structure_only',
  units: 9,
  used: false,
  added: true,
};

const WITH_ADDED = withAddedSources(PREPARED, [ADDED])!;

/** The press closed, under a Sources section that lists a document it added. */
export function AddSourceSurface() {
  return (
    <div>
      <SourcesSection live={false} subjectId={SUBJECT_ID} sources={WITH_ADDED} readings={[]} />
      <AddSource subjectId={SUBJECT_ID} />
    </div>
  );
}

/** The box open, before anything is typed. */
export function AddSourceOpenSurface() {
  return (
    <div>
      <SourcesSection live={false} defaultOpen={false} subjectId={SUBJECT_ID} sources={PREPARED} readings={[]} />
      <AddSource subjectId={SUBJECT_ID} drawn={{ open: true }} />
    </div>
  );
}

/** Mid-press: the address typed, the line saying what it is doing. */
export function AddSourceFetchingSurface() {
  return (
    <div>
      <SourcesSection live={false} defaultOpen={false} subjectId={SUBJECT_ID} sources={PREPARED} readings={[]} />
      <AddSource
        subjectId={SUBJECT_ID}
        drawn={{ open: true, pending: true, value: 'https://www.example.com/saas-metrics-2/' }}
      />
    </div>
  );
}

/** The fetch failed: the address stays in the box and the reason is under it. */
export function AddSourceErrorSurface() {
  return (
    <div>
      <SourcesSection live={false} defaultOpen={false} subjectId={SUBJECT_ID} sources={PREPARED} readings={[]} />
      <AddSource
        subjectId={SUBJECT_ID}
        drawn={{
          open: true,
          value: 'https://www.example.com/pricing',
          state: {
            error: 'The page has no sections to read: it needs at least two headings that lay it out.',
          },
        }}
      />
    </div>
  );
}
