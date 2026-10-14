import { sectionSubject } from '@/lib/core/section-path';
import { BriefView } from '@/app/learn/b/[id]/brief-view';
import { BriefsList } from '@/app/learn/now/briefs-list';
import type { BriefOnPage, BriefPage, BriefSource, BriefSummary } from '@/lib/learn/briefs/view';

/**
 * A researched topic (plan #2023.4), from fixtures shaped like `learn.briefs`
 * and the readings its run found. The question is the one the feature was
 * written around: how SOX controls apply to AI.
 */

const R = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, '0')}`;

const sources: Record<string, BriefSource> = {
  [R(1)]: {
    readingId: R(1),
    title: 'Staff Statement on the Use of Artificial Intelligence in Financial Reporting and Internal Control',
    kind: 'regulator',
    year: 2025,
    foundAt: '2026-10-13T09:02:00Z',
    url: 'https://example.org/sec-staff-statement',
  },
  [R(2)]: {
    readingId: R(2),
    title: 'AS 2201: An Audit of Internal Control Over Financial Reporting',
    kind: 'regulator',
    year: 2024,
    foundAt: '2026-10-13T09:02:00Z',
    url: 'https://example.org/pcaob-as2201',
  },
  [R(3)]: {
    readingId: R(3),
    title: 'Internal Control – Integrated Framework: applying the principles to AI-enabled processes',
    kind: 'professional_body',
    year: 2024,
    foundAt: '2026-10-13T09:03:00Z',
    url: 'https://example.org/coso-ai',
  },
  [R(4)]: {
    readingId: R(4),
    title: 'Auditing AI in the close: what we are seeing in ITGC testing',
    kind: 'firm',
    year: 2026,
    foundAt: '2026-10-13T09:03:00Z',
    url: 'https://example.org/firm-itgc',
  },
  [R(5)]: {
    readingId: R(5),
    title: 'Why your AI copilot is now a key control',
    kind: 'vendor',
    year: null,
    foundAt: '2026-10-13T09:04:00Z',
    url: 'https://example.org/vendor-copilot',
  },
};

const ready: BriefOnPage = {
  id: '00000000-0000-4000-8000-000000000301',
  trackId: '00000000-0000-4000-8000-000000000401',
  trackTitle: 'How SOX controls apply to AI',
  question: 'How do SOX controls apply to AI used in the financial close and in reporting?',
  angle:
    'I audit IT general controls and clients are starting to use AI in the close. I want to hold my own in a conversation with a controller and answer it well in an interview.',
  depth: 'standard',
  subQuestions: [
    { id: '1', text: 'When does an AI tool become part of internal control over financial reporting?' },
    { id: '2', text: 'What do the regulators expect management to document and test?' },
    { id: '3', text: 'How do IT general controls change when a model replaces a person reviewing entries?' },
    { id: '4', text: 'Who is liable when an AI-prepared figure turns out to be wrong in a filed report?' },
  ],
  status: 'ready',
  stage: null,
  error: null,
  sections: [
    {
      sub_question_id: '1',
      position:
        'As soon as its output feeds a figure or a review that management relies on. The tool is then in scope as part of the process, and the controls around it are tested like any other automated control.',
      citations: [
        {
          reading_id: R(1),
          quote:
            'Where an AI tool performs or supports a control, management should consider the tool within its assessment of internal control over financial reporting.',
        },
        { reading_id: R(3), quote: 'The principles apply regardless of whether a process is performed by people or by technology.' },
      ],
    },
    {
      sub_question_id: '2',
      position:
        'Nothing new in kind: a description of what the tool does, who reviews its output and how, and evidence that the review happened. The staff statement asks for more on how management knows the output is reliable over time.',
      citations: [
        { reading_id: R(1), quote: 'Management should be able to explain how it monitors the continued reliability of the tool’s output.' },
        { reading_id: R(2), quote: 'The auditor should test those controls that are important to the auditor’s conclusion.' },
      ],
    },
    {
      sub_question_id: '3',
      position:
        'Change management and access matter more: a model update is a change to a control, and the review that replaces a person needs its own precision threshold. Firms report testing model versioning the way they test configuration.',
      citations: [
        { reading_id: R(4), quote: 'We now ask for the model version in use for the period and evidence of approval for every change to it.' },
        { reading_id: R(5), quote: 'Treat your copilot like any key control: owner, frequency, evidence.' },
      ],
    },
  ],
  shortAnswer:
    'SOX does not have rules for AI; it has rules for controls, and an AI tool is in scope as soon as a figure or a review depends on it. So the questions are the usual ones asked of an automated control: who owns it, how changes to it are approved, how management knows its output is still right, and what evidence shows the review happened. The new part is the model itself: an update to it is a change to the control, and testing its reliability over time is what regulators are now asking about.',
  shortAnswerBy: 'dash',
  watchOn: false,
  watchedAt: null,
  quietChecks: 0,
  archivedAt: null,
  createdAt: '2026-10-13T09:00:00Z',
  updatedAt: '2026-10-13T09:10:00Z',
};

const readyPage: BriefPage = { brief: ready, sources };

export function LearnBriefSurface() {
  // The path the page reads from the catalogue: Learn › Now › the brief.
  const path = sectionSubject('/learn/now', 'Now', {
    label: ready.question,
    href: `/learn/b/${ready.id}`,
  });
  return <BriefView page={readyPage} live={false} path={path} />;
}

/**
 * Watched, with two sources weekly checks found since (plan #2023.8): the
 * newer not opened yet, so marked new, and each with its line on what it
 * changes in the answer.
 */
export function LearnBriefNewSourcesSurface() {
  const watched: BriefPage = {
    brief: { ...ready, watchOn: true, watchedAt: '2026-10-13T06:00:00Z', quietChecks: 0 },
    sources: {
      ...sources,
      [R(6)]: {
        readingId: R(6),
        title: 'Staff guidance on inspecting controls that rely on machine learning models in the financial close',
        kind: 'regulator',
        year: 2026,
        foundAt: '2026-10-13T06:01:00Z',
        url: 'https://example.org/pcaob-staff-guidance',
        change:
          'Inspectors will now ask for the log of every model change in the period, which makes change management the first thing to test rather than one item among several.',
        isNew: true,
      },
      [R(7)]: {
        readingId: R(7),
        title: 'What controllers told us about AI in the close',
        kind: 'press',
        year: null,
        foundAt: '2026-10-06T06:01:00Z',
        url: 'https://example.org/press-controllers',
        change:
          'Adds that most companies still keep a person reviewing every AI-prepared entry, so the tool is rarely a key control on its own yet.',
        isNew: false,
      },
    },
  };
  return <BriefView page={watched} live={false} />;
}

/** A quote's source, as hovering or tapping the first quote shows it. */
export function LearnBriefQuoteSourceSurface() {
  return <BriefView page={readyPage} live={false} openQuote="1:0" />;
}

/** The short answer open in its editor, as pressing it does. */
export function LearnBriefShortAnswerEditorSurface() {
  return <BriefView page={readyPage} live={false} editing />;
}

/** Mid-run: the sub-questions framed and two sources found, nothing answered yet. */
export function LearnBriefResearchingSurface() {
  const researching: BriefPage = {
    brief: {
      ...ready,
      status: 'researching',
      stage: 'writing',
      sections: [],
      shortAnswer: '',
      watchedAt: null,
    },
    sources: { [R(1)]: sources[R(1)]!, [R(2)]: sources[R(2)]! },
  };
  return <BriefView page={researching} live={false} />;
}

export function LearnBriefFailedSurface() {
  const failed: BriefPage = {
    brief: {
      ...ready,
      status: 'failed',
      error: 'The web search stopped answering after four of the twelve searches. Nothing was charged for the rest.',
      sections: [],
      shortAnswer: '',
      watchedAt: null,
    },
    sources: {},
  };
  return <BriefView page={failed} live={false} />;
}

const summaries: BriefSummary[] = [
  {
    id: ready.id,
    question: ready.question,
    status: 'ready',
    subQuestions: 4,
    updatedAt: '2026-10-13T09:10:00Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000302',
    question: 'What does the EU AI Act require of a bank using a model to score credit applications?',
    status: 'researching',
    subQuestions: 3,
    updatedAt: '2026-10-14T08:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-000000000303',
    question: 'Revenue recognition for usage-based pricing',
    status: 'failed',
    subQuestions: 0,
    updatedAt: '2026-10-12T17:00:00Z',
  },
];

export function LearnNowBriefsSurface() {
  return <BriefsList briefs={summaries} />;
}
