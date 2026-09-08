import { RoleDetailPanels, type PanelProps } from '@/app/jobs/(app)/roles/[id]/panels';

/**
 * The surfaces worth looking at, rendered from the real components.
 *
 * The point of this file is the imports at the top of it. Every previous
 * attempt at seeing this app -- five sweeps' worth -- hand-wrote markup that
 * *resembled* a surface, screenshotted that, and concluded something about the
 * app. That is a drawing of the thing, and a drawing agrees with whatever the
 * person drawing it already believed. These are the components themselves,
 * under the real tokens, at real widths.
 *
 * The fixtures are typed as the components' own props, which is what stops
 * this rotting: a prop that changes shape breaks `tsc` here, so a surface
 * cannot quietly start previewing something the app no longer renders.
 *
 * What it does not have is the shell, and the data does not come through a
 * loader or a database -- Docker is unavailable in this environment, so
 * PostgREST and GoTrue cannot run, and a real page cannot be served. So this
 * is honest about its scope: it is the content surfaces, which is where the
 * clunk lives and where every judgement call in the design laws applies. The
 * shell is one component and has already been swept.
 */
export type Surface = {
  id: string;
  label: string;
  module: 'jobs' | 'shopping' | 'todo' | 'vault' | 'learn' | 'dev';
  /** How wide the thing is meant to be read at, in the real app. */
  width: 'narrow' | 'wide';
  render: () => React.ReactNode;
};

/**
 * A role mid-process: a rejection at the top of the timeline, two inferred
 * events needing confirmation, one interview scheduled, an unanswered
 * question. Chosen to be an ordinary Tuesday rather than a showcase -- an
 * empty surface hides every density problem, and a maximal one hides which
 * problems are real.
 */
const rolePanels: PanelProps = {
  roleId: 'role-1',
  applicationId: 'app-1',
  jdText:
    'We are looking for a quantitative developer to work alongside our systematic trading teams. You will build and maintain the research tooling that turns an idea into a backtest and a backtest into a live strategy.',
  jdLookupNote: null,
  jdUrl: 'https://example.com/jobs/quant-dev',
  atsJobId: 'REQ-4471',
  compMinCents: 18000000,
  compMaxCents: 24000000,
  compSource: 'posting',
  requirements: [
    { text: 'Strong Python', kind: 'must_have' },
    { text: 'Experience with market data at scale', kind: 'must_have' },
    { text: 'C++ a plus', kind: 'nice_to_have' },
  ],
  requirementMatches: null,
  requirementMatchesAt: null,
  requirementMatchesStale: false,
  bankSize: 6,
  caseStatement: '',
  caseSlug: null,
  caseExpiresAt: null,
  appOrigin: 'https://example.com',
  timezone: 'Europe/London',
  focusInterviewId: null,
  events: [
    {
      id: 'e1',
      kind: 'rejection',
      occurredAt: '2026-09-08T09:02:00.000Z',
      source: 'email',
      summary: 'From the D. E. Shaw group',
      needsReview: false,
      gmailHref: 'https://mail.google.com/mail/u/0/#inbox/1',
    },
    {
      id: 'e2',
      kind: 'confirmation',
      occurredAt: '2026-09-01T08:30:00.000Z',
      source: 'email',
      summary: 'Your application to the D. E. Shaw group',
      needsReview: false,
      gmailHref: 'https://mail.google.com/mail/u/0/#inbox/2',
    },
    {
      id: 'e3',
      kind: 'submitted',
      occurredAt: '2026-07-31T12:00:00.000Z',
      source: 'system',
      summary: 'Inferred from a confirmation email — confirm the details',
      needsReview: true,
      gmailHref: null,
    },
  ],
  interviews: [
    {
      id: 'i1',
      kind: 'phone_screen',
      scheduledAt: '2026-09-15T14:00:00.000Z',
      timeKnown: true,
      debriefDue: false,
      format: 'video',
      status: 'scheduled',
      prepNotes: '',
      notes: '',
      customNotes: [],
      groupId: 'g1',
      questionsAsked: [],
      participants: [{ contactId: 'c1', name: 'Dana Ruiz', title: 'Engineering Manager', role: 'interviewer' }],
    },
  ],
  companyContacts: [{ id: 'c1', name: 'Dana Ruiz', title: 'Engineering Manager' }],
  answers: [
    {
      id: 'a1',
      answer: '',
      status: 'unanswered',
      questionId: 'q1',
      questionText: 'Why this team?',
      questionKind: 'motivation',
      canonicalAnswer: null,
      timesSeen: 3,
      evidenceItemIds: [],
      unsupportedClaims: [],
    },
  ],
  notes: [],
  interviewGroups: [
    { id: 'g1', label: 'First round', roundNumber: 1, notes: '', messageIds: [] },
  ],
  companyName: 'The D. E. Shaw group',
  matchCandidates: [],
  otherAttempts: [],
  todos: [
    {
      id: 't1',
      body: 'Record a video interview',
      dueAt: '2026-09-12T00:00:00.000Z',
      message: null,
    },
  ],
  messages: [
    {
      id: 'm1',
      subject: 'From the D. E. Shaw group',
      fromAddress: 'careers@deshaw.example',
      receivedAt: '2026-09-08T09:02:00.000Z',
      classification: 'rejection',
      linkMethod: 'ats_id',
      linkConfidence: 0.98,
      gmailHref: 'https://mail.google.com/mail/u/0/#inbox/1',
    },
  ],
};

export const SURFACES: readonly Surface[] = [
  {
    id: 'jobs-role-timeline',
    label: 'Role · Timeline and to-dos',
    module: 'jobs',
    width: 'wide',
    render: () => <RoleDetailPanels {...rolePanels} initialTab="timeline" />,
  },
  {
    id: 'jobs-role-answers',
    label: 'Role · Answers',
    module: 'jobs',
    width: 'wide',
    render: () => <RoleDetailPanels {...rolePanels} initialTab="answers" />,
  },
  {
    id: 'jobs-role-interviews',
    label: 'Role · Interviews',
    module: 'jobs',
    width: 'wide',
    render: () => <RoleDetailPanels {...rolePanels} initialTab="interviews" />,
  },
];
