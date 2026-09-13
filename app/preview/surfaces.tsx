import { RoleDetailPanels, type PanelProps } from '@/app/jobs/(app)/roles/[id]/panels';
import { PipelineBoard } from '@/components/jobs/pipeline/board';
import { PipelineDenseList } from '@/components/jobs/pipeline/dense-list';
import { SurfaceReview } from '@/app/dev/surfaces/review';
import DevUiPage from '@/app/dev/ui/page';
import { ANATOMIES } from '@/app/dev/ui/anatomy';
import { ItemDetailsPanel } from '@/app/shopping/inventory/[id]/item-details-panel';
import { CompanyPanels } from '@/app/jobs/(app)/companies/[slug]/panels';
import { ReviewQueue } from '@/app/jobs/(app)/review/list';
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
import type { ModuleId } from '@/lib/modules';
import { CalendarMonthGrid } from '@/components/todo/calendar-month';
import {
  monthDays,
  monthOf,
  type CalendarDay,
  type CalendarEntry,
} from '@/lib/todo/calendar/month';
import { NoteProperties } from '@/components/vault/note-properties';
import { NoteBody } from '@/components/vault/note-body';
import { ReadingCard } from '@/components/learn/reading-card';
import type { ReadingRow } from '@/lib/learn/tracks/load';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

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
  /** Which workspace it belongs to, so the gallery and the review agree. */
  module: ModuleId;
  /**
   * How wide the thing is meant to be read at, in the real app. `page` is for
   * a whole page arrangement, which draws its own box the way a page does
   * rather than being centred in a column this route picked for it.
   */
  width: 'narrow' | 'wide' | 'page';
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
      participants: [
        { contactId: 'c1', name: 'Dana Ruiz', title: 'Engineering Manager', role: 'interviewer' },
      ],
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
  interviewGroups: [{ id: 'g1', label: 'First round', roundNumber: 1, notes: '', messageIds: [] }],
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
const pipelineRow = (
  row: Partial<PipelineRow> &
    Pick<PipelineRow, 'applicationId' | 'companyName' | 'roleTitle' | 'status'>,
): PipelineRow => ({
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
      {
        applicationId: 'p3',
        label: 'Monzo · Backend Engineer, Payments',
        reason: 'Company and role title both match',
        confidence: 0.91,
      },
      {
        applicationId: 'p5',
        label: 'Wise · Senior Engineer, Money Movement',
        reason: 'Same ATS vendor',
        confidence: 0.22,
      },
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
    {
      id: 'cv1',
      label: 'Engineering — 2026',
      isDefault: true,
      notes: 'The one that goes to platform roles.',
      hasText: true,
    },
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
  {
    id: 'c1',
    fullName: 'Dana Ruiz',
    title: 'Engineering Manager, Research Platform',
    relationship: 'interviewer',
    status: 'replied',
    companyName: 'The D. E. Shaw group',
    companySlug: 'de-shaw',
    lastTouchAt: '2026-08-21T08:30:00.000Z',
    pendingReplies: 0,
  },
  {
    id: 'c2',
    fullName: 'Priyanka Raghunathan',
    title: 'Technical Recruiter',
    relationship: 'recruiter',
    status: 'contacted',
    companyName: 'The D. E. Shaw group',
    companySlug: 'de-shaw',
    lastTouchAt: '2026-09-02T11:00:00.000Z',
    pendingReplies: 1,
  },
  {
    id: 'c3',
    fullName: 'Tom Beale',
    title: null,
    relationship: 'warm_intro',
    status: 'not_contacted',
    companyName: 'Monzo',
    companySlug: 'monzo',
    lastTouchAt: null,
    pendingReplies: 0,
  },
  {
    id: 'c4',
    fullName: 'Aoife Ní Bhraonáin',
    title: 'Head of Engineering',
    relationship: 'hiring_manager',
    status: 'contacted',
    companyName: 'Starling Bank',
    companySlug: 'starling-bank',
    lastTouchAt: '2026-08-30T09:10:00.000Z',
    pendingReplies: 2,
  },
  {
    id: 'c5',
    fullName: 'Sam Okonjo',
    title: 'Staff Engineer',
    relationship: 'friend',
    status: 'replied',
    companyName: null,
    companySlug: null,
    lastTouchAt: '2026-07-19T20:00:00.000Z',
    pendingReplies: 0,
  },
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
    {
      id: 't1',
      channel: 'linkedin_dm',
      direction: 'outbound',
      sentAt: '2026-08-30T09:10:00.000Z',
      respondedAt: null,
      message: 'Asked whether the platform role is still open after the reorg.',
    },
    {
      id: 't2',
      channel: 'email',
      direction: 'outbound',
      sentAt: '2026-08-12T18:00:00.000Z',
      respondedAt: null,
      message: 'Sent the write-up she asked for at the meetup.',
    },
    {
      id: 't3',
      channel: 'event',
      direction: 'inbound',
      sentAt: '2026-03-04T19:30:00.000Z',
      respondedAt: '2026-03-04T19:30:00.000Z',
      message: 'Met at the London Systems meetup.',
    },
  ],
};

const knownCompanies = [...new Set(pipelineRows.map((row) => row.companyName))].map((name) => ({
  name,
}));

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

/**
 * A month with an ordinary amount in it: a week carrying three things, one
 * square over the dot limit, a couple of finished tasks and a long run of
 * empty days.
 *
 * The empty days are half the reason this surface exists. A calendar is read
 * for the Thursday with nothing on it as much as for the Tuesday with four,
 * and a fixture that fills every square would hide which of the two is drawn
 * badly.
 */
const CALENDAR_MONTH = '2026-09';
const CALENDAR_TODAY = '2026-09-10';

const calendarEntries: Record<string, CalendarEntry[]> = {
  '2026-09-03': [
    {
      key: 'task:c1',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      title: 'Renew the travel insurance',
      href: null,
      done: true,
    },
  ],
  '2026-09-09': [
    {
      key: 'item:c2',
      kind: 'item',
      at: '2026-09-09T08:30:00.000Z',
      end: null,
      eventId: null,
      title: 'Return window closes — Sony WH-1000XM5',
      href: '/shopping/returns',
      done: false,
    },
  ],
  '2026-09-10': [
    {
      key: 'task:c3',
      kind: 'task',
      at: '2026-09-10T09:00:00.000Z',
      end: null,
      eventId: null,
      title: 'Send the reconciliation write-up to Dana',
      href: null,
      done: false,
    },
    {
      key: 'context:c4',
      kind: 'context',
      at: '2026-09-10T13:30:00.000Z',
      end: null,
      eventId: null,
      title: 'Dentist',
      href: null,
      done: false,
    },
    {
      key: 'task:c5',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      title: 'Book the flights',
      href: null,
      done: false,
    },
  ],
  '2026-09-11': [
    {
      key: 'item:c6',
      kind: 'item',
      at: '2026-09-11T13:30:00.000Z',
      end: null,
      eventId: null,
      title: 'Marshall Wace · Technical',
      href: '/jobs/roles/role-p1',
      done: false,
    },
  ],
  '2026-09-16': [
    {
      key: 'item:c7',
      kind: 'item',
      at: '2026-09-16T08:00:00.000Z',
      end: null,
      eventId: null,
      title: 'The D. E. Shaw group · Final',
      href: '/jobs/roles/role-p2',
      done: false,
    },
    {
      key: 'task:c8',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      title: 'Write the prep note',
      href: null,
      done: false,
    },
    {
      key: 'task:c9',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      title: 'Chase the take-home feedback',
      href: null,
      done: false,
    },
    {
      key: 'task:c10',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      title: 'Cancel the trial',
      href: null,
      done: false,
    },
    // Five in one square, which is where the phone stops drawing dots and says
    // how many are left. A state no tidy fixture would ever produce.
    {
      key: 'task:c11',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      title: 'Order the bike part',
      href: null,
      done: false,
    },
  ],
  '2026-09-24': [
    {
      key: 'task:c12',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      title: 'Quarterly tax payment',
      href: null,
      done: false,
    },
  ],
  '2026-10-01': [
    {
      key: 'task:c13',
      kind: 'task',
      at: null,
      end: null,
      eventId: null,
      title: 'Rent',
      href: null,
      done: false,
    },
  ],
};

const calendarDays: CalendarDay[] = monthDays(CALENDAR_MONTH).map((day) => ({
  day,
  inMonth: monthOf(day) === CALENDAR_MONTH,
  isToday: day === CALENDAR_TODAY,
  entries: calendarEntries[day] ?? [],
}));

/**
 * A note somebody actually wrote: frontmatter, headings, a list, a table, a
 * quote, a fenced block and a link.
 *
 * Every one of those is a different rule in the vault's prose styles, and the
 * styles are the whole surface -- there is no chrome here to look at. A note
 * of three paragraphs would say nothing about the ones that carry structure.
 */
const noteFrontmatter: Record<string, unknown> = {
  tags: ['postgres', 'ops'],
  status: 'in progress',
  updated: '2026-08-30',
  source: 'https://www.postgresql.org/docs/16/routine-vacuuming.html',
};

const noteMarkdown = `The nightly close was six hours and most of it was one query. Writing down
what actually fixed it, because I will not remember in a year.

## What was slow

The reconciliation join scanned the whole ledger every night, and the ledger
grows. Nothing was wrong with the plan — there was just more of it each week.

- The join key was indexed, and the index was being used.
- The table had not been vacuumed since the bulk load in March.
- Autovacuum was running, and giving up: \`autovacuum_vacuum_cost_limit\` was
  still at the default.

## What it costs now

| Step | Before | After |
| --- | --- | --- |
| Extract | 40m | 38m |
| Reconcile | 4h 50m | 22m |
| Publish | 30m | 28m |

> Do not tune the query before you have looked at whether the table is a
> swamp. I lost a day to a rewrite that changed nothing.

The incremental version keeps a watermark per source and only reads what moved:

\`\`\`sql
select *
from ledger
where updated_at > (select watermark from sync_state where source = 'bank')
order by updated_at;
\`\`\`

Next: work out whether the same trick applies to the settlement file, which is
[the other slow one](https://example.com/runbooks/settlement).
`;

/**
 * A track part way through: two read, one on the shelf now, one queued with a
 * verified chapter, one the app has only guessed at, and one with no source
 * found at all.
 *
 * The guessed locator and the missing source are the point. They are what this
 * module is for and the two states a hand-drawn fixture never includes.
 */
const readingRow = (
  row: Partial<ReadingRow> & Pick<ReadingRow, 'id' | 'position' | 'status' | 'subject'>,
): ReadingRow => ({
  title: null,
  why: null,
  note: null,
  locatorKind: 'chapter',
  locatorLabel: null,
  locatorBasis: 'stated',
  locatorConfidence: 'verified',
  openUrl: null,
  textAnchor: null,
  pageFrom: null,
  pageTo: null,
  finishedAt: null,
  readNowAt: null,
  conceptId: null,
  source: null,
  ...row,
});

const trackReadings: ReadingRow[] = [
  readingRow({
    id: 'rd1',
    position: 1,
    status: 'read',
    subject: 'Designing Data-Intensive Applications',
    locatorLabel: 'Chapter 5, Replication',
    pageFrom: 151,
    pageTo: 197,
    finishedAt: '2026-08-18T20:10:00.000Z',
    openUrl: 'https://dataintensive.net',
    source: {
      id: 's1',
      title: 'Designing Data-Intensive Applications',
      author: 'Martin Kleppmann',
      kind: 'book',
      year: 2017,
      canonicalUrl: 'https://dataintensive.net',
      access: 'purchase',
      priceCents: 4199,
      pageCount: 616,
    },
  }),
  readingRow({
    id: 'rd2',
    position: 2,
    status: 'reading',
    subject: 'Jepsen: PostgreSQL 12.3',
    why: 'The failure modes are the part nobody writes down.',
    readNowAt: '2026-09-09T19:00:00.000Z',
    openUrl: 'https://jepsen.io/analyses/postgresql-12.3',
    locatorKind: 'section',
    locatorLabel: 'Serializable snapshot isolation',
    source: {
      id: 's2',
      title: 'PostgreSQL 12.3',
      author: 'Kyle Kingsbury',
      kind: 'report',
      year: 2020,
      canonicalUrl: 'https://jepsen.io/analyses/postgresql-12.3',
      access: 'open',
      priceCents: null,
      pageCount: null,
    },
  }),
  readingRow({
    id: 'rd3',
    position: 3,
    status: 'queued',
    subject: 'Routine vacuuming',
    locatorLabel: 'Chapter 25.1',
    locatorBasis: 'inferred',
    locatorConfidence: 'unverified',
    openUrl: 'https://www.postgresql.org/docs/16/routine-vacuuming.html',
    source: {
      id: 's3',
      title: 'PostgreSQL 16 documentation',
      author: null,
      kind: 'documentation',
      year: 2023,
      canonicalUrl: 'https://www.postgresql.org/docs/16/',
      access: 'open',
      priceCents: null,
      pageCount: null,
    },
  }),
  readingRow({
    id: 'rd4',
    position: 4,
    status: 'queued',
    subject: 'The paper about hybrid logical clocks somebody mentioned at the meetup',
    why: 'Came up twice in a week. Find out whether it is the same thing as a vector clock.',
  }),
  readingRow({
    id: 'rd5',
    position: 5,
    status: 'abandoned',
    subject: 'Transaction Processing: Concepts and Techniques',
    note: 'Too much of it is about hardware nobody runs. Kept chapter 7 and gave up on the rest.',
    source: {
      id: 's5',
      title: 'Transaction Processing: Concepts and Techniques',
      author: 'Jim Gray and Andreas Reuter',
      kind: 'book',
      year: 1992,
      canonicalUrl: null,
      access: 'library',
      priceCents: null,
      pageCount: 1070,
    },
  }),
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
        values={{
          players: '2–4',
          bgg: 'https://boardgamegeek.com/boardgame/224517',
          weight: '3.9',
        }}
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
      <ReviewQueue
        rows={reviewRows}
        counts={{
          all: reviewRows.length,
          messages: reviewRows.filter((row) => row.kind === 'message').length,
          applications: reviewRows.filter((row) => row.kind === 'application').length,
          events: reviewRows.filter((row) => row.kind === 'event').length,
        }}
        view="all"
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
    /* The month grid, which is the todo module's densest surface and the one
     * with a phone layout of its own. */
    id: 'todo-calendar-month',
    label: 'Calendar · A month',
    module: 'todo',
    width: 'wide',
    render: () => (
      <CalendarMonthGrid
        days={calendarDays}
        timezone="Europe/London"
        newEventHref={(day) => `/todo/calendar?new=${day}`}
        eventHref={(id) => `/todo/calendar?event=${id}`}
      />
    ),
  },
  {
    /* A note, read. The vault has almost no chrome, so what there is to judge
     * is the prose styles and the properties table above them. */
    id: 'vault-note',
    label: 'Note · Properties and body',
    module: 'vault',
    width: 'narrow',
    render: () => (
      <>
        <NoteProperties frontmatter={noteFrontmatter} />
        <NoteBody markdown={noteMarkdown} />
      </>
    ),
  },
  {
    /* A track's readings, in the one surface the module is read on. The list
     * is the page: everything else on /learn/t/[id] is a header and a form. */
    id: 'learn-track-readings',
    label: 'Track · The readings',
    module: 'learn',
    width: 'narrow',
    render: () => (
      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {trackReadings.map((reading) => (
          <ReadingCard key={reading.id} reading={reading} />
        ))}
      </ul>
    ),
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

  /* The page anatomies, framed at two widths by the anatomy section on
   * /dev/ui. They are registered from one list rather than written out again
   * here, and that list never holds /dev/ui itself -- an anatomy of the page
   * doing the framing would put the gallery inside itself. */
  ...ANATOMIES.map((anatomy) => ({
    id: anatomy.id,
    label: `Anatomy · ${anatomy.label}`,
    module: 'dev' as const,
    width: 'page' as const,
    render: anatomy.render,
  })),
];
