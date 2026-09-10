import { RoleDetailPanels, type PanelProps } from '@/app/jobs/(app)/roles/[id]/panels';
import { PipelineBoard } from '@/components/jobs/pipeline/board';
import { PipelineDenseList } from '@/components/jobs/pipeline/dense-list';
import { SurfaceReview } from '@/app/dev/surfaces/review';
import DevUiPage from '@/app/dev/ui/page';
import { ItemDetailsPanel } from '@/app/shopping/inventory/[id]/item-details-panel';
import { CompanyPanels } from '@/app/jobs/(app)/companies/[slug]/panels';
import { ReviewList } from '@/app/jobs/(app)/review/list';
import { SettingsView } from '@/app/jobs/(app)/settings/view';
import { ContactsView, type ContactListRow, type ContactRow } from '@/app/jobs/(app)/contacts/view';
import { ContactDetail } from '@/app/jobs/(app)/contacts/[id]/contact-detail';
import { RoleForm } from '@/app/jobs/(app)/roles/new/role-form';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import type { ReviewRow, SearchableRole } from '@/lib/jobs/review/load';
import { RolesTable } from '@/app/jobs/(app)/roles/roles-table';
import { RoundsTable, type RoundView } from '@/app/jobs/(app)/interviews/rounds-table';
import { TodayLists } from '@/app/jobs/(app)/today/lists';
import type { TodayBoard } from '@/lib/jobs/today/load';

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
      prepNote: null,
      prepNoteAt: null,
      prepNoteStale: false,
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

/**
 * An ordinary week's board: eleven pursuits across every live column, two
 * closed ones behind the fold, one gone quiet long enough to say so, and one
 * still waiting on its first confirmation.
 *
 * The names are the point. "Ramp" tells you nothing about wrapping and every
 * hand-drawn fixture in this app's history has been full of them, so the set
 * is deliberately mixed: a two-word company, a very long one, a role title
 * that will not fit a card, and one attempt that is somebody's second go.
 */
const pipelineRow = (row: Partial<PipelineRow> & Pick<PipelineRow, 'applicationId' | 'companyName' | 'roleTitle' | 'status'>): PipelineRow => ({
  roleId: `role-${row.applicationId}`,
  companyId: `co-${row.applicationId}`,
  companySlug: 'a-company',
  companyLogoUrl: null,
  companyDomains: [],
  companyWebsite: null,
  location: 'London',
  workMode: 'hybrid',
  source: 'portal',
  attempt: 1,
  excitement: 3,
  needsReview: false,
  createdBy: 'user',
  submittedAt: '2026-08-14T09:00:00.000Z',
  confirmationReceivedAt: '2026-08-14T09:04:00.000Z',
  firstHumanResponseAt: null,
  closedAt: null,
  outcome: null,
  rejectionStage: null,
  nextAction: null,
  nextActionDue: null,
  lastActivityAt: '2026-09-05T10:00:00.000Z',
  daysSinceActivity: 4,
  compMinCents: null,
  compMaxCents: null,
  coverage: { covered: 0, total: 0, gaps: 0, rate: null },
  ...row,
});

const pipelineRows: PipelineRow[] = [
  pipelineRow({
    applicationId: 'p1',
    companyName: 'Marshall Wace',
    roleTitle: 'Quantitative Developer, Systematic Strategies',
    status: 'in_process',
    excitement: 5,
    compMinCents: 18000000,
    compMaxCents: 24000000,
    daysSinceActivity: 1,
    lastActivityAt: '2026-09-08T16:00:00.000Z',
    coverage: { covered: 4, total: 6, gaps: 1, rate: 0.67 },
  }),
  pipelineRow({
    applicationId: 'p2',
    companyName: 'The D. E. Shaw group',
    roleTitle: 'Software Developer',
    status: 'in_process',
    excitement: 4,
    daysSinceActivity: 3,
    lastActivityAt: '2026-09-06T11:00:00.000Z',
    coverage: { covered: 5, total: 5, gaps: 0, rate: 1 },
  }),
  pipelineRow({
    applicationId: 'p3',
    companyName: 'Monzo',
    roleTitle: 'Backend Engineer, Payments',
    status: 'acknowledged',
    source: 'referral',
    daysSinceActivity: 9,
    lastActivityAt: '2026-08-31T09:00:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p4',
    companyName: 'Starling Bank',
    roleTitle: 'Platform Engineer',
    status: 'acknowledged',
    // Long enough to be called stale on the card, which is a state the board
    // has to draw and no empty fixture would ever show.
    daysSinceActivity: 21,
    lastActivityAt: '2026-08-19T10:00:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p5',
    companyName: 'Wise',
    roleTitle: 'Senior Engineer, Money Movement',
    status: 'submitted',
    submittedAt: '2026-09-06T18:20:00.000Z',
    confirmationReceivedAt: null,
    daysSinceActivity: 3,
    lastActivityAt: '2026-09-06T18:20:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p6',
    companyName: 'Cleo',
    roleTitle: 'Data Engineer',
    status: 'drafting',
    submittedAt: null,
    confirmationReceivedAt: null,
    excitement: 2,
    daysSinceActivity: 6,
    lastActivityAt: '2026-09-03T12:00:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p7',
    companyName: 'Ocado Technology',
    roleTitle: 'Simulation Engineer',
    status: 'lead',
    submittedAt: null,
    confirmationReceivedAt: null,
    source: 'job_board',
    excitement: null,
    daysSinceActivity: 12,
    lastActivityAt: '2026-08-28T08:00:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p8',
    companyName: 'Palantir Technologies UK',
    roleTitle: 'Forward Deployed Engineer',
    status: 'lead',
    submittedAt: null,
    confirmationReceivedAt: null,
    source: 'recruiter_inbound',
    daysSinceActivity: 2,
    lastActivityAt: '2026-09-07T14:00:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p9',
    companyName: 'Man Group',
    roleTitle: 'Research Engineer',
    status: 'offer',
    excitement: 5,
    compMinCents: 21000000,
    compMaxCents: 21000000,
    firstHumanResponseAt: '2026-08-20T09:00:00.000Z',
    daysSinceActivity: 0,
    lastActivityAt: '2026-09-08T17:30:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p10',
    companyName: 'Revolut',
    roleTitle: 'Engineering Manager, Core Banking',
    status: 'rejected',
    outcome: 'rejected',
    rejectionStage: 'recruiter_screen',
    closedAt: '2026-08-29T16:00:00.000Z',
    attempt: 2,
    daysSinceActivity: 11,
    lastActivityAt: '2026-08-29T16:00:00.000Z',
  }),
  pipelineRow({
    applicationId: 'p11',
    companyName: 'Deliveroo',
    roleTitle: 'Staff Engineer',
    status: 'ghosted',
    outcome: 'ghosted',
    daysSinceActivity: 47,
    lastActivityAt: '2026-07-24T10:00:00.000Z',
  }),
];

/**
 * A company you have done the reading on: research written, three people on
 * file at different stages of being contacted, one send still unanswered.
 */
const companyPanels = {
  companyId: 'co-1',
  research:
    'Systematic manager, roughly 500 people in London. The research platform team owns the backtester and the data pipeline; the posting is on that team.\n\nThey moved off a vendor risk system in 2024, which is what the "market data at scale" line in the posting is about.',
  domains: 'deshaw.com, deshaw.co.uk',
  industry: 'Quantitative investment management',
  hqLocation: 'New York, NY',
  careersUrl: 'https://www.deshaw.com/careers',
  linkedinUrl: 'https://www.linkedin.com/company/de-shaw',
  website: 'https://www.deshaw.com',
  priority: 'high',
  timezone: 'Europe/London',
  contacts: [
    {
      id: 'c1',
      fullName: 'Dana Ruiz',
      title: 'Engineering Manager, Research Platform',
      relationship: 'interviewer',
      status: 'replied',
      linkedinUrl: 'https://www.linkedin.com/in/dana-ruiz',
      email: 'dana.ruiz@deshaw.example',
      howWeConnect: 'Ran the phone screen.',
    },
    {
      id: 'c2',
      fullName: 'Priyanka Raghunathan',
      title: 'Technical Recruiter',
      relationship: 'recruiter',
      status: 'contacted',
      linkedinUrl: null,
      email: 'p.raghunathan@deshaw.example',
      howWeConnect: null,
    },
    {
      id: 'c3',
      fullName: 'Tom Beale',
      title: null,
      relationship: 'warm_intro',
      status: 'not_contacted',
      linkedinUrl: 'https://www.linkedin.com/in/tom-beale',
      email: null,
      howWeConnect: 'Worked with him at the last place; he knows the platform team.',
    },
  ],
  touches: [
    {
      id: 'tt1',
      channel: 'linkedin_dm',
      direction: 'outbound',
      sentAt: '2026-09-02T11:00:00.000Z',
      respondedAt: null,
      message: 'Asked whether the platform team is still hiring past the one posting.',
      contactName: 'Tom Beale',
    },
    {
      id: 'tt2',
      channel: 'email',
      direction: 'outbound',
      sentAt: '2026-08-21T08:30:00.000Z',
      respondedAt: '2026-08-21T15:12:00.000Z',
      message: 'Thanks for the screen — sent the follow-up note.',
      contactName: 'Dana Ruiz',
    },
  ],
  notes: [
    {
      id: 'n1',
      body: 'Interview loop is four conversations in one day. Ask for the schedule a week out.',
      createdAt: '2026-08-22T09:00:00.000Z',
    },
  ],
};

/**
 * The review queue on a normal morning: two unlinked messages, one of which
 * the matcher is confident about and one it is not, an application it inferred
 * from a confirmation, and an event it could not place.
 */
const reviewRows: ReviewRow[] = [
  {
    kind: 'message',
    id: 'r1',
    subject: 'Your application to Monzo — Backend Engineer, Payments',
    fromAddress: 'no-reply@greenhouse.io',
    receivedAt: '2026-09-09T07:41:00.000Z',
    classification: 'confirmation',
    reason: 'Sent by an ATS, and no pursuit on file matches the job id.',
    gmailHref: 'https://mail.google.com/mail/u/0/#inbox/10',
    candidates: [
      { applicationId: 'p3', label: 'Monzo · Backend Engineer, Payments', reason: 'Company and role title both match', confidence: 0.91 },
      { applicationId: 'p5', label: 'Wise · Senior Engineer, Money Movement', reason: 'Same ATS vendor', confidence: 0.22 },
    ],
    sortAt: '2026-09-09T07:41:00.000Z',
  },
  {
    kind: 'message',
    id: 'r2',
    subject: 'Following up',
    fromAddress: 'kate@thehiringpartners.example',
    receivedAt: '2026-09-08T16:03:00.000Z',
    classification: 'other',
    reason: 'A person wrote it, and nothing in it names a role.',
    gmailHref: 'https://mail.google.com/mail/u/0/#inbox/11',
    candidates: [],
    sortAt: '2026-09-08T16:03:00.000Z',
  },
  {
    kind: 'application',
    id: 'r3',
    applicationId: 'p4',
    roleId: 'role-p4',
    companyName: 'Starling Bank',
    companyDomains: ['starlingbank.com'],
    roleTitle: 'Platform Engineer',
    status: 'acknowledged',
    submittedAt: '2026-08-14T09:00:00.000Z',
    reason: 'Created from a confirmation email. Nobody has confirmed the details.',
    sortAt: '2026-08-14T09:00:00.000Z',
  },
  {
    kind: 'event',
    id: 'r4',
    applicationId: 'p1',
    roleId: 'role-p1',
    companyName: 'Marshall Wace',
    roleTitle: 'Quantitative Developer, Systematic Strategies',
    status: 'in_process',
    eventKind: 'interview_scheduled',
    summary: 'Recorded, but it did not change the status — that would have moved this backwards.',
    occurredAt: '2026-09-08T12:00:00.000Z',
    reason: 'The status it implies is behind the one on file.',
    sortAt: '2026-09-08T12:00:00.000Z',
  },
];

const allRoles: SearchableRole[] = pipelineRows.map((row) => ({
  applicationId: row.applicationId,
  companyName: row.companyName,
  roleTitle: row.roleTitle,
  status: row.status,
  everSubmitted: row.submittedAt !== null,
}));

/**
 * Settings for somebody three weeks in: one inbox connected and scanned, one
 * resume, a couple of senders muted, and an evidence bank with something in it.
 */
const settings = {
  email: 'chris@example.com',
  banner: null,
  gmailConfigured: true,
  appOrigin: 'https://example.com',
  profile: {
    targetTitles: 'Quantitative Developer, Backend Engineer, Platform Engineer',
    searchStartedOn: '2026-07-06',
    ghostThresholdDays: 21,
    writingStyleNotes: 'Plain sentences. No "passionate", no "excited to".',
    bannedConstructions: 'leverage, synergy, reach out',
  },
  accounts: [
    {
      id: 'ib1',
      emailAddress: 'chris@example.com',
      status: 'connected',
      lastSyncedAt: '2026-09-09T06:15:00.000Z',
      backfillCompletedAt: '2026-07-07T22:40:00.000Z',
      backfillWindowDays: 180,
      latestBackfill: {
        status: 'completed',
        messagesSeen: 4128,
        error: null,
        finishedAt: '2026-07-07T22:40:00.000Z',
      },
    },
  ],
  resumes: [
    { id: 'cv1', label: 'Engineering — 2026', isDefault: true, notes: 'The one that goes to platform roles.', hasText: true },
    { id: 'cv2', label: 'Quant', isDefault: false, notes: null, hasText: false },
  ],
  excludedSenders: [
    { id: 'x1', domain: 'jobalerts.linkedin.com' },
    { id: 'x2', domain: 'hi.wellfound.com' },
  ],
  evidence: [
    {
      id: 'ev1',
      title: 'Cut the nightly close from six hours to forty minutes',
      body: 'Rewrote the settlement reconciliation as an incremental job and moved the joins into the warehouse. The team stopped being paged for it.',
      context: 'Last role, 2025',
      skills: ['Python', 'dbt', 'Postgres'],
      metrics: '6h → 40m, on 40m rows a night',
      strength: 5,
      usedCount: 3,
    },
    {
      id: 'ev2',
      title: 'Took over the on-call rota nobody wanted',
      body: '',
      context: null,
      skills: ['Leadership'],
      metrics: null,
      strength: 2,
      usedCount: 0,
    },
  ],
};

/** Nine people on file, in every state a send to somebody can be in. */
const contactRows: ContactListRow[] = [
  { id: 'c1', fullName: 'Dana Ruiz', title: 'Engineering Manager, Research Platform', relationship: 'interviewer', status: 'replied', companyName: 'The D. E. Shaw group', companySlug: 'de-shaw', lastTouchAt: '2026-08-21T08:30:00.000Z', pendingReplies: 0 },
  { id: 'c2', fullName: 'Priyanka Raghunathan', title: 'Technical Recruiter', relationship: 'recruiter', status: 'contacted', companyName: 'The D. E. Shaw group', companySlug: 'de-shaw', lastTouchAt: '2026-09-02T11:00:00.000Z', pendingReplies: 1 },
  { id: 'c3', fullName: 'Tom Beale', title: null, relationship: 'warm_intro', status: 'not_contacted', companyName: 'Monzo', companySlug: 'monzo', lastTouchAt: null, pendingReplies: 0 },
  { id: 'c4', fullName: 'Aoife Ní Bhraonáin', title: 'Head of Engineering', relationship: 'hiring_manager', status: 'contacted', companyName: 'Starling Bank', companySlug: 'starling-bank', lastTouchAt: '2026-08-30T09:10:00.000Z', pendingReplies: 2 },
  { id: 'c5', fullName: 'Sam Okonjo', title: 'Staff Engineer', relationship: 'friend', status: 'replied', companyName: null, companySlug: null, lastTouchAt: '2026-07-19T20:00:00.000Z', pendingReplies: 0 },
];

const contact: ContactRow = {
  id: 'c4',
  fullName: 'Aoife Ní Bhraonáin',
  title: 'Head of Engineering',
  relationship: 'hiring_manager',
  status: 'contacted',
  linkedinUrl: 'https://www.linkedin.com/in/aoife-ni-bhraonain',
  email: 'aoife@starlingbank.example',
  howWeConnect: 'Spoke at the same meetup in March; she remembered the talk.',
  notes: 'Owns the platform group. Prefers a short note to a long one.',
  companyName: 'Starling Bank',
  companySlug: 'starling-bank',
  touches: [
    { id: 't1', channel: 'linkedin_dm', direction: 'outbound', sentAt: '2026-08-30T09:10:00.000Z', respondedAt: null, message: 'Asked whether the platform role is still open after the reorg.' },
    { id: 't2', channel: 'email', direction: 'outbound', sentAt: '2026-08-12T18:00:00.000Z', respondedAt: null, message: 'Sent the write-up she asked for at the meetup.' },
    { id: 't3', channel: 'event', direction: 'inbound', sentAt: '2026-03-04T19:30:00.000Z', respondedAt: '2026-03-04T19:30:00.000Z', message: 'Met at the London Systems meetup.' },
  ],
};

const knownCompanies = [...new Set(pipelineRows.map((row) => row.companyName))].map((name) => ({ name }));

/**
 * A week with something in every section: two rounds coming up, one of them a
 * superday with no prep written, mail that asked a question a fortnight ago,
 * and two nudges the nightly sweep raised.
 */
const todayBoard: TodayBoard = {
  clear: false,
  interviews: [
    {
      id: 'ti1',
      applicationId: 'p1',
      roleId: 'role-p1',
      companyName: 'Marshall Wace',
      roleTitle: 'Quantitative Developer, Systematic Strategies',
      scheduledAt: '2026-09-11T13:30:00.000Z',
      timeKnown: true,
      kind: 'technical',
      format: 'video',
      durationMinutes: 60,
      meetingUrl: 'https://meet.example.com/mw-tech',
      location: null,
      hasPrep: true,
      groupId: 'tg1',
      round: { id: 'tg1', roundNumber: 2, label: 'Technical', notes: '' },
    },
    {
      id: 'ti2',
      applicationId: 'p2',
      roleId: 'role-p2',
      companyName: 'The D. E. Shaw group',
      roleTitle: 'Software Developer',
      scheduledAt: '2026-09-16T08:00:00.000Z',
      timeKnown: false,
      kind: 'onsite',
      format: 'onsite',
      durationMinutes: null,
      meetingUrl: null,
      location: 'London office',
      hasPrep: false,
      groupId: 'tg2',
      round: { id: 'tg2', roundNumber: 3, label: 'Final', notes: '' },
    },
    {
      id: 'ti3',
      applicationId: 'p2',
      roleId: 'role-p2',
      companyName: 'The D. E. Shaw group',
      roleTitle: 'Software Developer',
      scheduledAt: '2026-09-16T10:00:00.000Z',
      timeKnown: false,
      kind: 'hiring_manager',
      format: 'onsite',
      durationMinutes: null,
      meetingUrl: null,
      location: 'London office',
      hasPrep: false,
      groupId: 'tg2',
      round: { id: 'tg2', roundNumber: 3, label: 'Final', notes: '' },
    },
  ],
  waiting: [
    {
      eventId: 'tw1',
      applicationId: 'p3',
      roleId: 'role-p3',
      companyName: 'Monzo',
      roleTitle: 'Backend Engineer, Payments',
      kind: 'question',
      summary: 'Asked for three dates in the week of the 21st and a note on notice period.',
      occurredAt: '2026-08-28T14:20:00.000Z',
    },
  ],
  reminders: [
    {
      id: 'tr1',
      kind: 'follow_up',
      body: 'No reply to the take-home submission in nine days.',
      dueAt: '2026-09-09T00:00:00.000Z',
      applicationId: 'p4',
      roleId: 'role-p4',
      companyName: 'Starling Bank',
      roleTitle: 'Platform Engineer',
      followUpHref: 'https://mail.google.com/mail/?view=cm&to=&su=Following%20up',
    },
    {
      id: 'tr2',
      kind: 'manual',
      body: 'Record a video interview',
      dueAt: '2026-09-12T00:00:00.000Z',
      applicationId: 'p1',
      roleId: 'role-p1',
      companyName: 'Marshall Wace',
      roleTitle: 'Quantitative Developer, Systematic Strategies',
      followUpHref: null,
    },
  ],
};

/** Two upcoming rounds and three past ones, one of them still owing a debrief. */
const interviewRounds: RoundView[] = [
  {
    key: 'ir1',
    leadId: 'ti1',
    roleId: 'role-p1',
    companyName: 'Marshall Wace',
    roleTitle: 'Quantitative Developer, Systematic Strategies',
    scheduledAt: '2026-09-11T13:30:00.000Z',
    timeKnown: true,
    endsAt: Date.parse('2026-09-11T14:30:00.000Z'),
    round: 'Round 2 · Technical',
    kind: 'Technical',
    notes: null,
  },
  {
    key: 'ir2',
    leadId: 'ti2',
    roleId: 'role-p2',
    companyName: 'The D. E. Shaw group',
    roleTitle: 'Software Developer',
    scheduledAt: '2026-09-16T08:00:00.000Z',
    timeKnown: false,
    endsAt: Date.parse('2026-09-17T00:00:00.000Z'),
    round: 'Round 3 · Final',
    kind: '4 interviews',
    notes: null,
  },
  {
    key: 'ir3',
    leadId: 'ti4',
    roleId: 'role-p1',
    companyName: 'Marshall Wace',
    roleTitle: 'Quantitative Developer, Systematic Strategies',
    scheduledAt: '2026-08-27T09:00:00.000Z',
    timeKnown: true,
    endsAt: Date.parse('2026-08-27T09:45:00.000Z'),
    round: 'Round 1',
    kind: 'Phone screen',
    notes: 'Went well. She asked mostly about the reconciliation rewrite.',
  },
  {
    key: 'ir4',
    leadId: 'ti5',
    roleId: 'role-p10',
    companyName: 'Revolut',
    roleTitle: 'Engineering Manager, Core Banking',
    scheduledAt: '2026-08-25T15:00:00.000Z',
    timeKnown: true,
    endsAt: Date.parse('2026-08-25T15:30:00.000Z'),
    round: null,
    kind: 'Recruiter screen',
    notes: null,
  },
];

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
  {
    id: 'jobs-pipeline-board',
    label: 'Pipeline · Board',
    module: 'jobs',
    width: 'wide',
    render: () => <PipelineBoard rows={pipelineRows} view="board" />,
  },
  {
    /* The shopping item page's main panel, which arrived as a form until law
     * 14 reached it. Here so the read-first state can be looked at: it needs a
     * session and a row otherwise, which means nobody looks. */
    id: 'shopping-item-details',
    label: 'Inventory · Item details',
    module: 'shopping',
    width: 'wide',
    render: () => (
      <ItemDetailsPanel
        itemId="i1"
        item={{
          name: 'Brass Birmingham',
          variant: 'Deluxe edition',
          notes: 'Shelf C, second row. Insert is 3D printed; the box is a tight fit with it in.',
        }}
        categories={[
          { id: 'c1', name: 'Board games' },
          { id: 'c2', name: 'Books' },
        ]}
        categoryId="c1"
        categoryName="Board games"
        template={[
          { key: 'players', label: 'Players', type: 'text', inSearch: false },
          { key: 'bgg', label: 'BGG page', type: 'url', inSearch: false },
        ]}
        fields={[
          { key: 'players', label: 'Players', type: 'text', inSearch: false },
          { key: 'bgg', label: 'BGG page', type: 'url', inSearch: false },
          { key: 'weight', label: 'Weight', type: 'number', inSearch: false },
        ]}
        values={{ players: '2–4', bgg: 'https://boardgamegeek.com/boardgame/224517', weight: '3.9' }}
        searchAvailable
      />
    ),
  },
  {
    /* The design language, held to itself. It is the one surface where being
     * wrong is self-refuting, and it is the surface most likely to drift,
     * because it is written in prose and prose does not fail a type check. */
    id: 'dev-ui',
    label: 'UI · the design language',
    module: 'dev',
    width: 'wide',
    render: () => <DevUiPage />,
  },
  {
    /* The review tool, reviewed by itself. Circular on purpose: the frames it
     * draws are the same frames it is drawn in, so if the scaling is wrong it
     * is wrong here too. */
    id: 'dev-surfaces',
    label: 'Surfaces · the review tool',
    module: 'dev',
    width: 'wide',
    render: () => (
      <SurfaceReview
        surfaces={[
          {
            id: 'jobs-pipeline-dense',
            label: 'Pipeline · Dense list (experiment)',
            module: 'jobs',
            notes: [
              {
                id: 'n1',
                body: 'Rows are right but the stars are noisy at this size.',
                status: 'open',
                resolutionNote: null,
              },
            ],
          },
          {
            id: 'jobs-role-timeline',
            label: 'Role · Timeline and to-dos',
            module: 'jobs',
            notes: [],
          },
        ]}
      />
    ),
  },
  {
    /* The experiment. Same rows, same width, beside the thing it questions. */
    id: 'jobs-pipeline-dense',
    label: 'Pipeline · Dense list (experiment)',
    module: 'jobs',
    width: 'wide',
    render: () => <PipelineDenseList rows={pipelineRows} />,
  },
  {
    id: 'jobs-pipeline-list',
    label: 'Pipeline · List',
    module: 'jobs',
    width: 'wide',
    render: () => <PipelineBoard rows={pipelineRows} view="list" />,
  },
  {
    id: 'jobs-company',
    label: 'Company · Research, contacts and sends',
    module: 'jobs',
    width: 'wide',
    render: () => <CompanyPanels {...companyPanels} />,
  },
  {
    id: 'jobs-review',
    label: 'Review queue',
    module: 'jobs',
    width: 'wide',
    render: () => (
      <ReviewList
        rows={reviewRows}
        timezone="Europe/London"
        companyNames={knownCompanies.map((company) => company.name)}
        allRoles={allRoles}
      />
    ),
  },
  {
    id: 'jobs-settings',
    label: 'Settings',
    module: 'jobs',
    width: 'wide',
    render: () => <SettingsView {...settings} />,
  },
  {
    id: 'jobs-contacts',
    label: 'Contacts · List and add',
    module: 'jobs',
    width: 'wide',
    render: () => (
      <ContactsView
        contacts={contactRows}
        companies={[
          { id: 'co-1', name: 'The D. E. Shaw group' },
          { id: 'co-2', name: 'Monzo' },
          { id: 'co-3', name: 'Starling Bank' },
        ]}
        timezone="Europe/London"
      />
    ),
  },
  {
    id: 'jobs-contact',
    label: 'Contact · One person',
    module: 'jobs',
    width: 'narrow',
    render: () => <ContactDetail contact={contact} timezone="Europe/London" />,
  },
  {
    id: 'jobs-role-new',
    label: 'Role · New',
    module: 'jobs',
    width: 'wide',
    render: () => <RoleForm companies={knownCompanies} />,
  },
  {
    id: 'jobs-roles-table',
    label: 'Roles · The table',
    module: 'jobs',
    width: 'wide',
    render: () => <RolesTable rows={pipelineRows} sort="activity" params={{}} />,
  },
  {
    id: 'jobs-today',
    label: 'This week',
    module: 'jobs',
    width: 'wide',
    render: () => <TodayLists board={todayBoard} timezone="Europe/London" />,
  },
  {
    id: 'jobs-interviews',
    label: 'Interviews · Upcoming and past',
    module: 'jobs',
    width: 'wide',
    render: () => (
      <>
        <RoundsTable title="Upcoming" rows={interviewRounds.slice(0, 2)} timezone="Europe/London" />
        <RoundsTable title="Past" rows={interviewRounds.slice(2)} timezone="Europe/London" />
      </>
    ),
  },
];
