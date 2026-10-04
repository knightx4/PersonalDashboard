import { RoleDetailPanels, type PanelProps } from '@/app/jobs/(app)/roles/[id]/panels';
import { PipelineBoard } from '@/components/jobs/pipeline/board';
import { PipelineDenseList } from '@/components/jobs/pipeline/dense-list';
import { SurfaceReview } from '@/app/dev/surfaces/review';
import { SearchBarSurface } from './search-bar-surface';
import { CaptureBoxSurface } from './capture-surfaces';
import DevUiPage from '@/app/dev/ui/page';
import { ANATOMIES } from '@/app/dev/ui/anatomy';
import { TravelDemo } from '@/app/dev/ui/travel-demo';
import { SettleDemo } from '@/app/dev/ui/settle-demo';
import { ClearDemo } from '@/app/dev/ui/clear-demo';
import { DayCloseDemo } from '@/app/dev/ui/day-close-demo';
import { DayClosed } from '@/components/todo/day-closed';
import { GotThroughDemo } from '@/app/dev/ui/got-through-demo';
import { GotThrough } from '@/app/news/quick/got-through';
import { HomeArrivalDemo } from '@/app/dev/ui/home-arrival-demo';
import { ItemDetailsPanel } from '@/app/shopping/inventory/[id]/item-details-panel';
import { EstimatesTable } from '@/app/account/spend/estimates-table';
import { compareEstimate } from '@/lib/core/spend/comparison';
import {
  ESTIMATE_WINDOW_DAYS,
  MEASURED_MIN_RUNS,
  type MeasuredRange,
} from '@/lib/core/spend/estimate';
import type { OperationName } from '@/lib/core/spend/guesses';
import { CompanyPanels } from '@/app/jobs/(app)/companies/[slug]/panels';
import { ReviewQueue } from '@/app/jobs/(app)/review/list';
import { SettingsView } from '@/app/jobs/(app)/settings/view';
import { ContactsView, type ContactListRow, type ContactRow } from '@/app/jobs/(app)/contacts/view';
import { ContactDetail } from '@/app/jobs/(app)/contacts/[id]/contact-detail';
import { RoleForm } from '@/app/jobs/(app)/roles/new/role-form';
import { RecommendedRoles } from '@/app/jobs/(app)/recommend/sections';
import type { OpenSuggestion } from '@/lib/jobs/suggest/load';
import type { OriginStats } from '@/lib/jobs/suggest/stats';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import type { ReviewRow, SearchableRole } from '@/lib/jobs/review/load';
import { RolesTable } from '@/app/jobs/(app)/roles/roles-table';
import { rolesDisplay } from '@/lib/jobs/roles-display';
import { RoundsTable, type RoundView } from '@/app/jobs/(app)/interviews/rounds-table';
import { TodayLists } from '@/app/jobs/(app)/_home/this-week-lists';
import type { TodayBoard } from '@/lib/jobs/today/load';
import type { ModuleId } from '@/lib/modules';
import type { Interaction } from '@/lib/preview/interaction';
import type { Deck } from '@/lib/preview/deck';
import { CalendarMonthGrid } from '@/components/todo/calendar-month';
import { FeedEventCard } from '@/components/todo/feed-event-card';
import {
  monthDays,
  monthOf,
  type CalendarDay,
  type CalendarEntry,
} from '@/lib/todo/calendar/month';
import { NoteProperties } from '@/components/vault/note-properties';
import { NoteBody } from '@/components/vault/note-body';
import { NoteEdit } from '@/app/vault/n/[...path]/note-edit';
import { NoteEditingPreview } from './note-edit-surfaces';
import { buildAttachmentIndex, type AttachmentEntry } from '@/lib/vault/markdown/attachments';
import { buildLinkIndex, toStandardMarkdown } from '@/lib/vault/markdown/obsidian';
import { noteHref } from '@/lib/vault/paths';
import { PageHeader } from '@/components/shell/page-header';
import { AddTranscript } from '@/app/vault/education/add-transcript';
import { EducationCheckPreview, EducationUploadPreview } from './education-surfaces';
import { FlowScopePreview, LearnGoalsPreview } from './learn-goal-surfaces';
import {
  LearnCourseCheckPreview,
  LearnCoursesEmptyPreview,
  LearnCoursesListPreview,
} from './learn-course-surfaces';
import { SchoolCourses } from '@/app/vault/education/course-list';
import { educationGroups, educationCounts } from './education-fixtures';
import { ReadingCard } from '@/components/learn/reading-card';
import { LearnNowFeed } from '@/app/learn/now/feed';
import type { FeedCard } from '@/lib/learn/feed/card';
import { ConceptList } from '@/components/learn/concept-list';
import type { ReadingRow } from '@/lib/learn/tracks/load';
import type { Concept } from '@/lib/learn/graph/model';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { DisplayMenu } from '@/components/shell/display-menu';
import { GroupHeader } from '@/components/shell/group-header';
import {
  groupRows,
  isHidden,
  listDisplayMenu,
  parseListDisplay,
  sortRows,
  type ListDisplaySpec,
} from '@/lib/list-display';
import { formatMoney } from '@/lib/money';
import { Thread } from '@/components/thread/thread';
import { threadRef } from '@/lib/thread/subjects';
import type { DevComment } from '@/lib/comments/load';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { CostHint } from '@/components/ui/cost-hint';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import { IssueView, type IssueViewProps } from '@/app/news/i/[id]/issue-view';
import { QuickReadView, type QuickReadViewProps } from '@/app/news/quick/quick-view';
import { SavedView, type SavedViewProps } from '@/app/news/saved/saved-view';
import { StoryGrid, type GridStory } from '@/components/news/story-grid';
import { StoryText } from '@/components/news/story-text';
import {
  PlanCriticStopSurface,
  PlanOpenedSurface,
  PlanTreeSurface,
  ProjectPlanSurface,
} from './plan-surfaces';
import { GoalOpenedSurface, GoalTreeSurface } from './goal-surfaces';
import {
  AskChangesSurface,
  AskDashSurface,
  AskMadeChangesSurface,
  FAILING_QUESTION,
  TRIP_GOAL,
} from './ask-surfaces';
import { RecurringEmptySurface, RecurringSurface } from './recurring-surfaces';
import { TimelineSurface, YearReviewSurface } from './timeline-surfaces';
import { WatchingSurface } from './watching-surfaces';
import { ClipStreamSurface, ClipsEmptySurface } from './clip-surfaces';
import {
  InspirationByVideoSurface,
  InspirationListSurface,
  InspirationUnreadSurface,
} from './inspiration-surfaces';
import { PostsDraftingSurface, PostsSurface } from './posts-surfaces';
import {
  GoalBareSurface,
  GoalLinkingSurface,
  GoalTopSurface,
  FileSurface,
  GoalsAllSurface,
  GoalsHomeSurface,
  InformationListSurface,
  InformationOneSurface,
} from './goal-page-surfaces';
import {
  AuthCodeErrorSurface,
  ConsentSurface,
  FrontDoorSurface,
  LoginSurface,
  OnboardingGmailSurface,
  OnboardingWelcomeSurface,
  OpenMissingSurface,
  PrivacySurface,
  ResetPasswordSurface,
  ShareFormSurface,
  SignupSurface,
  TermsSurface,
} from './public-surfaces';
import { WeekReviewNoneSurface, WeekReviewSurface } from './week-surfaces';
import {
  AccountSurface,
  DevBugsSurface,
  DevChangelogSurface,
  DevIdeasSurface,
  DevRaisedSurface,
  DevSpecSurface,
  DevSpecsSurface,
  DevUiReviewSurface,
  DevUsageSurface,
} from './dev-page-surfaces';

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
   * rather than being centred in a column this route picked for it. `screen`
   * is for a page outside the shell that draws the whole screen itself (the
   * front door, the sign-in card, a shared form): no box and no workspace,
   * as the app serves it.
   */
  width: 'narrow' | 'wide' | 'page' | 'screen';
  render: () => React.ReactNode;
  /**
   * The press, swipe or completion `npm run record` plays on this surface and
   * keeps as a strip of frames (lib/preview/interaction.ts). Left out, the
   * surface is not recorded.
   */
  interaction?: Interaction;
  /**
   * Marks a screen you move through one item at a time, and where its Next
   * and its item are (lib/preview/deck.ts). The phone checks then hold it to
   * Next showing the next item with the network held, and to every control
   * and link showing a press within 100 milliseconds.
   */
  deck?: Deck;
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
  coverLetter: '',
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
  thread: [],
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
  lastTurnEvent: null,
  compMinCents: null,
  compMaxCents: null,
  coverage: { covered: 0, total: 0, gaps: 0, rate: null },
  ...row,
});

/** The sort links the roles table draws, with nothing chosen but its default. */
const rolesSortChoices = listDisplayMenu(rolesDisplay(), {}).sorts;

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
    // Already interviewing, so chance is left off and only fit shows.
    scoreNote: { fit: { value: 73, unsure: false, reason: '5 of 5 must-haves met by your evidence' }, chance: null },
  }),
  pipelineRow({
    applicationId: 'p3',
    companyName: 'Monzo',
    roleTitle: 'Backend Engineer, Payments',
    status: 'acknowledged',
    source: 'referral',
    scoreNote: {
      fit: { value: 56, unsure: true, reason: 'Read from the title and level only, no description on file' },
      chance: { value: 36, band: 'medium', unsure: true, reason: '2 of 14 similar reached an interview, 3 still waiting' },
    },
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
    threadId: 'thread-monzo-payments',
    replyToAddress: 'careers@monzo.example',
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
    // The unplaceable one has neither, which is why the matcher has nothing.
    threadId: null,
    replyToAddress: null,
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
    excludedIndustries: 'Crypto, Healthcare, Defense',
    searchStartedOn: '2026-07-06',
    ghostThresholdDays: 21,
    writingStyleNotes: 'Plain sentences. No "passionate", no "excited to".',
    bannedConstructions: 'leverage, synergy, reach out',
    preferences: {
      homeLocation: 'London',
      workplaces: ['hybrid', 'remote'] as const,
      salaryFloorCents: 9_000_000,
      companyStages: ['growth', 'late'] as const,
    },
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
      hasPdf: true,
    },
    { id: 'cv2', label: 'Quant', isDefault: false, notes: null, hasText: false, hasPdf: false },
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
      feedEventId: null,
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
      feedEventId: null,
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
      feedEventId: null,
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
      feedEventId: null,
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
      feedEventId: null,
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
      feedEventId: null,
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
      feedEventId: null,
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
      feedEventId: null,
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
      feedEventId: null,
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
      feedEventId: null,
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
      feedEventId: null,
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
      feedEventId: null,
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
      feedEventId: null,
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
/**
 * A note that embeds one of everything the note page tells apart (plan #1302).
 * The pictures are drawn as SVG data URLs so the gallery needs no storage.
 */
const attachmentRows: AttachmentEntry[] = [
  { id: 'beach', path: 'Attachments/Beach day.png', sizeBytes: 812_000, mimeType: 'image/png', storagePath: 'u/c/beach' },
  { id: 'plan', path: 'Attachments/floor-plan.jpg', sizeBytes: 240_000, mimeType: 'image/jpeg', storagePath: 'u/c/plan' },
  { id: 'lease', path: 'Money/lease.pdf', sizeBytes: 380_000, mimeType: 'application/pdf', storagePath: 'u/c/lease' },
  { id: 'memo', path: 'Audio/voice memo.m4a', sizeBytes: 2_100_000, mimeType: 'audio/mp4', storagePath: 'u/c/memo' },
  { id: 'scan', path: 'Scans/tax-return.pdf', sizeBytes: 61_000_000, mimeType: 'application/pdf', storagePath: null },
  { id: 'receipt', path: 'Attachments/receipt.webp', sizeBytes: 90_000, mimeType: 'image/webp', storagePath: null },
];

function pictureUrl(width: number, height: number, sky: string, ground: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${sky}"/><rect y="${Math.round(height * 0.62)}" width="100%" height="100%" fill="${ground}"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

const attachmentPictures: Record<string, string> = {
  beach: pictureUrl(1600, 900, '#9cc7e4', '#e8d3a3'), /* ui-ok: the photo's own colours, not the app's */
  plan: pictureUrl(1200, 800, '#f2f2ee', '#c9c9c2'), /* ui-ok: the floor plan's own colours, not the app's */
  lease: '#',
  memo: '#',
};

const attachmentNote = `The flat on Harbour Road, from the viewing on Saturday.

![[Beach day.png]]

The floor plan the agent sent, at the size I keep it in Obsidian:

![[floor-plan.jpg|300]]

The lease to sign: ![[lease.pdf]]

What the landlord said about the deposit:

![[voice memo.m4a]]

![[gone.png]]

![[tax-return.pdf]]

![[receipt.webp]]

![[sketch.svg]]
`;

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
  tStartSeconds: null,
  tEndSeconds: null,
  finishedAt: null,
  readNowAt: null,
  conceptId: null,
  newsStoryId: null,
  source: null,
  ...row,
});

/**
 * A subject's chain, with the doors in it. Four concepts is what one goal
 * leaves standing; the point of the surface is the two groups and the size
 * difference between them.
 */
const subjectConcepts: Concept[] = [
  {
    id: 'k1',
    name: 'Opportunity cost',
    claim:
      'A choice costs you the next best thing you could have done with the same time or money, whether or not any of it changed hands.',
    claimOriginal: null,
    claimRewrittenAt: null,
    catalogueSearchedAt: null,
    basis: 'Standard in any first-year sequence, and the one the rest of the chain rests on.',
    kind: 'threshold',
    state: 'shaky',
    established: 'tested',
    misconception: null,
    mastery: [],
    testedAt: '2026-09-02T09:00:00.000Z',
    declaredAt: null,
  },
  {
    id: 'k2',
    name: 'Marginal thinking',
    claim:
      'The question is always what one more unit costs and returns, not what the whole activity is worth on average.',
    claimOriginal: null,
    claimRewrittenAt: null,
    catalogueSearchedAt: null,
    basis: 'Named in the goal, and every model after it assumes you have it.',
    kind: 'threshold',
    state: 'unknown',
    established: 'inferred',
    misconception: null,
    mastery: [],
    testedAt: null,
    declaredAt: null,
  },
  {
    id: 'k3',
    name: 'Sunk cost',
    claim:
      'Money already spent is not a reason to continue, because it is gone under either choice.',
    claimOriginal: null,
    claimRewrittenAt: null,
    catalogueSearchedAt: null,
    basis: 'Follows from opportunity cost once the counterfactual is the comparison.',
    kind: 'consequence',
    state: 'misconception',
    established: 'tested',
    misconception: 'You treat the amount already spent as part of what continuing is worth.',
    mastery: [],
    testedAt: '2026-09-05T18:30:00.000Z',
    declaredAt: null,
  },
  {
    id: 'k4',
    name: 'Deadweight loss',
    claim:
      'A tax that changes behaviour destroys trades that both sides wanted, and that loss goes to nobody.',
    claimOriginal: null,
    claimRewrittenAt: null,
    catalogueSearchedAt: null,
    basis: 'Inferred from the goal, not checked against a syllabus.',
    kind: 'consequence',
    state: 'unknown',
    established: 'inferred',
    misconception: null,
    mastery: [],
    testedAt: null,
    declaredAt: null,
  },
];

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

/**
 * A list with display options, drawn from the shared control and the shared
 * group header, with no page behind it yet.
 *
 * The rows are orders because orders is the list with the least of this today
 * -- one grouping it cannot leave, no sort at all -- and it is where the
 * control lands first. The params are a set arrangement rather than the page's
 * own: a sort that is not the default, a grouping that is, and one property
 * turned off, so the panel shows a chosen row, an unchosen one and both states
 * of a switch at once.
 */
type SampleOrder = {
  id: string;
  merchant: string;
  month: string;
  monthLabel: string;
  person: string;
  number: string;
  inbox: string;
  items: string;
  totalCents: number;
};

const sampleOrders: SampleOrder[] = [
  {
    id: 'o1',
    merchant: 'Zatu Games',
    month: '2026-09',
    monthLabel: 'September 2026',
    person: 'Chris',
    number: 'ZT-88213',
    inbox: 'shop+zatu@…',
    items: 'Brass Birmingham, Ark Nova',
    totalCents: 11250,
  },
  {
    id: 'o2',
    merchant: 'Amazon',
    month: '2026-09',
    monthLabel: 'September 2026',
    person: 'Chris',
    number: '206-4471928',
    inbox: 'shop+amazon@…',
    items: 'USB-C cable, two of them',
    totalCents: 1899,
  },
  {
    id: 'o3',
    merchant: 'Waterstones',
    month: '2026-08',
    monthLabel: 'August 2026',
    person: 'Ana',
    number: 'WS-70119',
    inbox: 'shop+waterstones@…',
    items: 'The Mars Room',
    totalCents: 899,
  },
  {
    id: 'o4',
    merchant: 'Zatu Games',
    month: '2026-08',
    monthLabel: 'August 2026',
    person: 'Chris',
    number: 'ZT-87004',
    inbox: 'shop+zatu@…',
    items: 'Sleeves, 200',
    totalCents: 2400,
  },
];

const orderDisplay: ListDisplaySpec<SampleOrder> = {
  pathname: '/preview',
  sorts: [
    { id: 'newest', label: 'Newest', compare: (a, b) => b.month.localeCompare(a.month) },
    { id: 'oldest', label: 'Oldest', compare: (a, b) => a.month.localeCompare(b.month) },
    {
      id: 'total_desc',
      label: 'Total: high to low',
      compare: (a, b) => b.totalCents - a.totalCents,
    },
    {
      id: 'total_asc',
      label: 'Total: low to high',
      compare: (a, b) => a.totalCents - b.totalCents,
    },
  ],
  groups: [
    {
      id: 'month',
      label: 'Month',
      order: 'key-desc',
      bucket: (row) => ({ key: row.month, label: row.monthLabel }),
    },
    {
      id: 'merchant',
      label: 'Merchant',
      bucket: (row) => ({ key: row.merchant, label: row.merchant }),
    },
    {
      id: 'person',
      label: 'Whose order',
      bucket: (row) => ({ key: row.person, label: row.person }),
    },
  ],
  properties: [
    { id: 'merchant', label: 'Merchant', alwaysOn: true },
    { id: 'number', label: 'Order number' },
    { id: 'inbox', label: 'Inbox address' },
    { id: 'person', label: 'Whose order' },
    { id: 'items', label: 'What was in it' },
  ],
  defaultSort: 'newest',
  defaultGroup: 'month',
};

const orderDisplayParams = {
  s: 'shell-display-options',
  sort: 'total_desc',
  hide: 'inbox',
};

/**
 * A thread on a plan step: a question of yours and the answer under it.
 *
 * The answer is long and has a list, a link and a block of code in it, because
 * that is what a session writes back and it is the shape the thread has to lay
 * out -- an answer that happens to be one short paragraph proves nothing. The
 * times are counted back from now rather than written down, so the surface
 * keeps showing what a thread looks like this week instead of one from
 * whenever the fixture was typed.
 */
const commentThread: DevComment[] = [
  {
    id: 'fixture-1',
    author: 'me',
    body: "@dash the Dash's view is showing #412 and I never handed it over. Is the filter reading the row or the tree?",
    createdAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'fixture-2',
    author: 'claude',
    body: `The filter reads \`assignee\` off the row itself. The tree only rolls it up for the counts in the strip at the top of the page, so the view and the count can disagree and neither is wrong.

#412 is there because approving a step is what puts it in that view -- nothing has to be handed over separately:

- \`handStepToClaude\` sets the assignee on the step it was pressed on.
- The runner's list is \`workOrder\`, which leaves out decisions and anything already closed.
- The badge on the row is the column and nothing else, which is why it appears on rows you did not press anything on.

If you want the child back, take it back from its own menu -- that writes the column on that one row and leaves the parent alone:

\`\`\`ts
const ready = workOrder(sections, { assignee: 'claude' });
\`\`\`

The rule is written down in [the plan spec](https://example.com/docs/PLAN-SPEC.md), under how a feature is worked. Anything pasted in, <b>markup included</b>, is shown as the text it is.`,
    createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
  },
  {
    /* Two from Dash in a row: the answer, and then what the session that read
     * the code did about it. The pair is here because a run from one author is
     * what the shared header has to be looked at on. */
    id: 'fixture-3',
    author: 'claude',
    body: 'Reworded the done-when on #412 to say the count and the view are read off different things, and put the old wording in the thread on that step.',
    createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'fixture-4',
    author: 'me',
    body: '@dash take #412 back off Dash then, and leave the feature where it is.',
    createdAt: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
  },
];

function SharedDisplayOptions() {
  const state = parseListDisplay(orderDisplay, orderDisplayParams);
  const groups = groupRows(sortRows(sampleOrders, state), state.groupBy, (rows) =>
    formatMoney(rows.reduce((sum, row) => sum + row.totalCents, 0)),
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <DisplayMenu menu={listDisplayMenu(orderDisplay, orderDisplayParams)} />
      </div>
      {groups.map((group) => (
        <section key={group.key} className="space-y-2">
          <GroupHeader label={group.label} count={group.count} subtotal={group.subtotal} />
          <ul
            className={cn(
              cardVariants({ padding: 'none' }),
              'divide-y divide-border overflow-hidden',
            )}
          >
            {group.rows.map((row) => (
              <li key={row.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-ui text-ink">
                    {row.merchant}
                    {!isHidden(state, 'number') && (
                      <span className="ml-2 text-small text-ink-muted">{row.number}</span>
                    )}
                  </p>
                  {!isHidden(state, 'items') && (
                    <p className="truncate text-small text-ink-muted">{row.items}</p>
                  )}
                  {!isHidden(state, 'inbox') && (
                    <p className="truncate text-small text-ink-ghost">{row.inbox}</p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="tabular text-ui text-ink">{formatMoney(row.totalCents)}</p>
                  {!isHidden(state, 'person') && (
                    <p className="text-small text-ink-muted">{row.person}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * A newsletter issue as /news/i/[id] draws it (plan #788). A weekly roundup
 * with four stories: the first leads with a picture, one headline is a single
 * long unbroken word, the way a link-roundup names a repository, and two
 * stories carry no link.
 */
const issueBase: IssueViewProps = {
  issueId: 'issue-1',
  subject: 'The Week in Infrastructure #212: queues, caches and one bad deploy',
  byline: 'Infra Weekly · Tue 22 Sep, 07:14',
  back: { href: '/news/all', label: 'Newsletters' },
  digest: {
    summary:
      'A quieter week for launches and a busy one for post-mortems. The lead piece walks through how a payments company lost six hours to a cache that kept serving stale balances after a failover, and what they changed. Elsewhere: a benchmark of three Postgres-backed job queues, a new release of a popular tracing library, and a short essay on why most teams do not need Kubernetes yet.',
    stories: [
      {
        headline: 'Six hours of stale balances: a failover post-mortem',
        summary:
          "A replica promoted during a network partition kept its warm cache, so reads served balances from before the split. The fix was to tie cache generations to the primary's timeline ID rather than to wall-clock expiry.",
        link: 'https://example.com/blog/2026/09/stale-balances-post-mortem',
        // Drawn inline so the gallery needs no network for it, and wide
        // because the lead story spreads it across the card (plan #856).
        image:
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 160'%3E%3Crect width='320' height='160' fill='%23334155'/%3E%3Cpath d='M0 118 L70 70 L130 104 L190 62 L250 96 L320 74 V160 H0Z' fill='%2394a3b8'/%3E%3Ccircle cx='236' cy='40' r='16' fill='%23fbbf24'/%3E%3C/svg%3E",
        text: "At 02:14 a network partition split the primary from two of its replicas. The failover promoted one of them within forty seconds, which is what it is meant to do.\n\nWhat nobody had planned for was the cache in front of it. Its keys expired on a timer, not on a change of primary, so for six hours it went on serving balances written before the split.\n\nThe fix ties each cache generation to the primary's timeline ID. A promotion now empties the cache on the spot.",
      },
      {
        headline: 'github.com/example-org/postgres-backed-job-queue-benchmarks-2026',
        summary:
          'Three queues built on SKIP LOCKED were run at the same load for a week. The simplest one held its latency best, and the one with the most features fell over first when vacuum could not keep up.',
        link: 'https://github.com/example-org/postgres-backed-job-queue-benchmarks-2026',
      },
      {
        headline: 'Tracing library 4.0 drops the global registry',
        summary:
          "Every tracer is now passed explicitly, which breaks most existing setups. The maintainers say the upgrade is a morning's work for a typical service.",
      },
      {
        headline: 'You probably do not need Kubernetes yet',
        summary:
          'An essay arguing that a team under twenty engineers spends more on the platform than it saves. Its test is whether anyone on the team would notice a week without it.',
      },
    ],
  },
  digestError: null,
  showDigest: true,
  html: null,
  textBody: null,
  pictures: true,
  pictureCount: 1,
  blockedImages: 0,
  unsubscribeUrl: 'https://example.com/unsubscribe?u=abc123',
  picturesHref: '/news/i/issue-1?pictures=0',
  originalHref: '/news/i/issue-1?view=original',
  summaryHref: '/news/i/issue-1',
  // One story saved, so the gallery shows Save and Saved side by side (plan #869).
  savedHeadlines: ['Tracing library 4.0 drops the global registry'],
};

/** A single-essay newsletter: the summary is the whole digest. */
const issueEssay: IssueViewProps = {
  ...issueBase,
  issueId: 'issue-2',
  subject: 'On leaving things unfinished',
  byline: 'Slow Letters · Sun 20 Sep, 09:02',
  digest: {
    summary:
      "An essay about the half-built projects that pile up in any maker's life, and the argument that abandoning one on purpose is a skill. The writer keeps a list of what they stopped and why, and rereads it before starting anything new. Their point is that the list is less about guilt than about noticing which kinds of project they never finish.",
    stories: [],
  },
  unsubscribeUrl: null,
};

/** A newsletter whose digest failed: the email as it arrived, with one line above it. */
const issueFailed: IssueViewProps = {
  ...issueBase,
  issueId: 'issue-3',
  subject: 'Market notes for Monday',
  byline: 'Morning Tape · Mon 21 Sep, 06:30',
  digest: null,
  digestError: 'model returned no summary',
  showDigest: false,
  html: '<h2>Good morning</h2><p>Futures are flat ahead of the open. Three things to watch today: the jobs revision, two earnings reports after the close, and whether the long end keeps selling off.</p><p><img src="https://example.com/chart.png" alt="Chart of the ten-year yield"></p><p>That is it for today.</p>',
  pictures: false,
  pictureCount: 1,
  blockedImages: 1,
  picturesHref: '/news/i/issue-3',
};

/**
 * The Quick read card (plan #851): the lead story of the roundup above, with
 * its picture and its text folded under the summary, three more to come.
 */
/** Two of your notes on a story's subject (plan #1113), as the lookup returns them. */
const previewRelatedNotes = [
  {
    noteId: 'note-related-1',
    title: 'Failover drills we never ran',
    href: '/vault/n/Work/Failover%20drills%20we%20never%20ran.md',
  },
  {
    noteId: 'note-related-2',
    title: 'On replication lag',
    href: '/vault/n/Ideas/On%20replication%20lag.md',
  },
];

const quickStory: QuickReadViewProps = {
  card: {
    kind: 'story',
    story: issueBase.digest!.stories[0],
    issueId: 'issue-1',
    storyIndex: 0,
    subject: issueBase.subject,
    receivedAt: '2026-09-22T07:14:00Z',
    sender: {
      id: 'sender-1',
      email: 'hello@infraweekly.example',
      name: 'Infra Weekly',
      muted: false,
    },
    from: 'Infra Weekly',
    remainingInIssue: 4,
    alsoIn: [
      { issueId: 'issue-4', from: 'Morning Tape' },
      { issueId: 'issue-5', from: 'Local Brief' },
    ],
    repeats: [],
    reason: 'Ran in 3 of your newsletters',
    rating: 81,
  },
  arrived: '22 Sep, 07:14',
  nothingYet: false,
  related: previewRelatedNotes,
  pictures: true,
  picturesHref: '/news?pictures=0',
  issueHref: '/news/i/issue-1',
  seed: 'preview:2026-09-23:news',
  topics: {
    topics: ['Politics', 'Business', 'Technology', 'Culture'],
    selected: null,
    hrefs: {
      Politics: '/news?topic=Politics',
      Business: '/news?topic=Business',
      Technology: '/news?topic=Technology',
      Culture: '/news?topic=Culture',
    },
    allHref: '/news',
  },
};

/** A single-essay newsletter as one card: its subject and its summary, no picture. */
const quickEssay: QuickReadViewProps = {
  ...quickStory,
  related: null,
  card: {
    kind: 'essay',
    summary: issueEssay.digest!.summary,
    issueId: 'issue-2',
    storyIndex: 0,
    subject: issueEssay.subject,
    receivedAt: '2026-09-20T09:02:00Z',
    sender: { id: 'sender-2', email: 'letters@slow.example', name: 'Slow Letters', muted: false },
    from: 'Slow Letters',
    remainingInIssue: 1,
    alsoIn: [],
    repeats: [],
    reason: null,
  },
  arrived: '20 Sep, 09:02',
  issueHref: '/news/i/issue-2',
};

/**
 * Quick read on a laptop (plan #941): the story card above leading a page with
 * the essay beside it. Below md the gallery shows the single card instead.
 */
const quickPageView: QuickReadViewProps = {
  ...quickStory,
  page: [
    {
      card: quickStory.card!,
      arrived: '22 Sep, 07:14',
      saved: false,
      related: previewRelatedNotes,
      issueHref: '/news/i/issue-1',
    },
    {
      card: quickEssay.card!,
      arrived: '20 Sep, 09:02',
      saved: false,
      issueHref: '/news/i/issue-2',
    },
  ],
};

/** A picture drawn inline, so the gallery needs no network for it. */
function previewPicture(sky: string, hill: string): string {
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'%3E%3Crect width='320' height='180' fill='%23${sky}'/%3E%3Cpath d='M0 130 L80 84 L150 116 L220 70 L320 104 V180 H0Z' fill='%23${hill}'/%3E%3C/svg%3E`;
}

/**
 * A page of the News grid (plan #940): six stories from four newsletters, as
 * Quick read fills a page. Three carry a picture and three do not, the way a
 * page mixes newsletters summarised before and after pictures were kept. One
 * headline is a single long word, and one summary runs long.
 */
const gridStories: GridStory[] = [
  {
    key: 'issue-1:0',
    headline: issueBase.digest!.stories[0].headline,
    summary: issueBase.digest!.stories[0].summary,
    image: issueBase.digest!.stories[0].image,
    from: 'Infra Weekly',
    rating: 81,
    link: issueBase.digest!.stories[0].link,
    body: (
      <StoryText
        text={issueBase.digest!.stories[0].text}
        summary={issueBase.digest!.stories[0].summary}
      />
    ),
  },
  {
    key: 'issue-4:0',
    headline: 'Rail freight volumes rise for a third month',
    summary:
      'Container traffic on the main northern routes is up nine percent on last year, mostly from ports diverting cargo away from congested motorways.',
    image: previewPicture('1e3a8a', '60a5fa'),
    from: 'The Morning Ledger',
    rating: 58,
    link: 'https://example.com/ledger/rail-freight',
  },
  {
    key: 'issue-1:1',
    headline: issueBase.digest!.stories[1].headline,
    summary: issueBase.digest!.stories[1].summary,
    from: 'Infra Weekly',
    link: issueBase.digest!.stories[1].link,
  },
  {
    key: 'issue-5:0',
    headline: 'A museum reopens its print room after four years',
    summary:
      'The collection of eighteenth-century engravings is back on view by appointment, with a new reading room and a catalogue that is online for the first time. The curators have added a short guide to the printing methods behind each plate, and the first two months of slots were gone within a day.',
    from: 'Culture Desk',
  },
  {
    key: 'issue-6:0',
    headline: 'Council votes to keep the late-night bus routes',
    summary:
      'The three routes were due to be cut in January. A funding deal with two neighbouring boroughs keeps them running for another two years.',
    image: previewPicture('7c2d12', 'fb923c'),
    from: 'Local Brief',
    link: 'https://example.com/local/night-buses',
  },
  {
    key: 'issue-1:2',
    headline: issueBase.digest!.stories[2].headline,
    summary: issueBase.digest!.stories[2].summary,
    from: 'Infra Weekly',
  },
];

/**
 * A full laptop page of Quick read (note a5a59857): five stories, every one
 * with a picture, the case that has to fit a laptop screen without scrolling.
 */
const quickFullPage: QuickReadViewProps = {
  ...quickStory,
  page: gridStories.slice(0, 5).map((story, index) => {
    const from = story.from ?? 'Infra Weekly';
    return {
      card: {
        kind: 'story' as const,
        story: {
          headline: story.headline,
          summary: story.summary,
          image: previewPicture(
            ['1e3a8a', '7c2d12', '14532d', '4c1d95', '713f12'][index],
            '93c5fd',
          ),
          link: 'https://example.com/story',
          text: index === 0 ? issueBase.digest!.stories[0].text : undefined,
          topic: 'Business' as const,
        },
        issueId: `issue-${index + 1}`,
        storyIndex: 0,
        subject: issueBase.subject,
        receivedAt: '2026-09-22T07:14:00Z',
        sender: { id: `sender-${index + 1}`, email: 'hello@example.com', name: from, muted: false },
        from,
        remainingInIssue: 1,
        alsoIn: index === 0 ? [{ issueId: 'issue-9', from: 'Morning Tape' }] : [],
        repeats: [],
        reason: null,
      },
      arrived: '22 Sep, 07:14',
      saved: false,
      issueHref: `/news/i/issue-${index + 1}`,
    };
  }),
};

/**
 * The Saved tab (plan #870): three stories, newest saved first. The first has
 * its picture, full text and link; the second's newsletter has been deleted,
 * so its sender is not a link; the third has no link or text of its own.
 */
const savedStories: SavedViewProps = {
  stories: [
    {
      id: 'saved-1',
      issueId: 'issue-1',
      headline: issueBase.digest!.stories[0].headline,
      summary: issueBase.digest!.stories[0].summary,
      text: issueBase.digest!.stories[0].text ?? null,
      link: issueBase.digest!.stories[0].link ?? null,
      image: issueBase.digest!.stories[0].image ?? null,
      senderName: 'Infra Weekly',
      receivedAt: '2026-09-22T07:14:00Z',
      savedAt: '2026-09-23T08:02:00Z',
      discussedIndex: 0,
      arrived: '22 Sep, 07:14',
      related: previewRelatedNotes.slice(0, 1),
    },
    {
      id: 'saved-2',
      issueId: null,
      headline: issueBase.digest!.stories[1].headline,
      summary: issueBase.digest!.stories[1].summary,
      text: null,
      link: issueBase.digest!.stories[1].link ?? null,
      image: null,
      senderName: 'Infra Weekly',
      receivedAt: '2026-09-15T07:10:00Z',
      savedAt: '2026-09-16T21:40:00Z',
      arrived: '15 Sep, 07:10',
    },
    {
      id: 'saved-3',
      issueId: 'issue-2',
      headline: 'Keep a list of what you stopped, and why',
      summary: issueEssay.digest!.summary,
      text: null,
      link: null,
      image: null,
      senderName: 'Slow Letters',
      receivedAt: '2026-09-20T09:02:00Z',
      savedAt: '2026-09-20T12:30:00Z',
      arrived: '20 Sep, 09:02',
    },
  ],
};

/** The job search's eleven sections, as its layout lists them. */
const shellSections: NavSection[] = [
  { href: '/jobs', label: 'Home', icon: 'jobsHome', exact: true },
  { href: '/jobs/thoughts', label: 'Career goals', icon: 'careerGoals' },
  { href: '/jobs/pipeline', label: 'Pipeline', icon: 'pipeline' },
  { href: '/jobs/roles', label: 'Roles', icon: 'roles' },
  { href: '/jobs/companies', label: 'Companies', icon: 'companies' },
  { href: '/jobs/contacts', label: 'Contacts', icon: 'contacts' },
  { href: '/jobs/interviews', label: 'Interviews', icon: 'interviews' },
  { href: '/jobs/answers', label: 'Answers', icon: 'answers' },
  { href: '/jobs/analytics', label: 'Analytics', icon: 'analytics' },
  { href: '/jobs/activity', label: 'Activity', icon: 'activity' },
  { href: '/jobs/review', label: 'Review', icon: 'review', badge: 4 },
];

/**
 * Three Learn now cards for the deck: a lesson from a track that cites no
 * section (plan #978), one idea card in the form the writer now produces, and
 * one written before cards carried one idea each.
 */
const deckCards: FeedCard[] = [
  {
    id: '00000000-0000-4000-8000-000000000003',
    reason: 'lesson',
    kind: 'lesson',
    title: 'Price ceilings cause shortages',
    source: 'Economics · Markets and prices',
    track: { id: '00000000-0000-4000-8000-0000000000aa', name: 'Economics' },
    article: '',
    section: null,
    why: 'Next in your Economics track. It builds on Supply and demand curves.',
    takeaway:
      'A legal maximum price set below what the market would clear at leaves more people wanting the good than there is of it.',
    context:
      'A price ceiling is a law saying a good may not be sold above a set price. The market-clearing price is the one at which the amount people want to buy equals the amount sellers offer.',
    hook: 'When New York froze many rents after 1943, the city’s vacancy rate for controlled flats stayed below 2% for decades.',
    summary:
      'At the capped price, buyers ask for more than at the market price and sellers offer less, because some of them can no longer cover their costs. The gap has to be closed some other way: queues, waiting lists, favouritism or a black market.',
    example:
      'In 1970s America, a cap on petrol prices during the oil shocks led to queues that ran around the block, and some states rationed fuel by the last digit of the number plate.',
    question:
      'A city caps taxi fares at half what riders pay today. What happens to the wait for a taxi at rush hour, and why?',
    answer:
      'It gets longer. Fewer drivers work at the lower fare while more riders want a cheap ride, so the shortage shows up as time spent waiting.',
    depth: null,
    difficulty: null,
    returning: null,
    shown: [],
    rest: [],
    restMinutes: 0,
    link: null,
    site: null,
    licence: null,
    relatedNotes: [
      {
        noteId: 'note-related-3',
        title: 'Rent control in my city',
        href: '/vault/n/Housing/Rent%20control%20in%20my%20city.md',
      },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000001',
    reason: 'interest',
    kind: 'section',
    title: 'Planting on last year’s price',
    source: 'Cobweb model: Mechanism',
    track: null,
    article: 'Cobweb model',
    section: 'Mechanism',
    why: 'You write about economic system design (Economics).',
    takeaway:
      'When farmers plant based on last year’s price, prices can swing up and down for years instead of settling.',
    context:
      'Some goods, such as crops and livestock, must be planned a season or more before they are sold. The producer has to commit to an amount before seeing the price it will fetch.',
    hook: 'US hog prices swung in a four-year cycle for decades because farmers set next year’s herd from this year’s price.',
    summary:
      'A high price brings a glut the following season, the glut drives the price down, and the low price brings a shortage. Whether the swings die out depends on whether supply responds to price more or less steeply than demand does.',
    example:
      'Suppose demand is P = 100 − Q and farmers plant Q = P from last year’s price. Starting at P = 60, they plant 60, which sells at 40; next year they plant 40, which sells at 60. With equal slopes the cycle neither grows nor shrinks, and any steeper supply response makes it explode.',
    question:
      'A government starts publishing forecasts of next season’s price that farmers trust. What happens to the cycle, and why?',
    answer:
      'It damps or disappears. The cycle comes from planting on last year’s price; if farmers plant on an accurate forecast instead, output matches what the market will clear at, so the overshoot never starts.',
    depth: 'working',
    difficulty: null,
    returning: null,
    shown: [
      'The cobweb model or cobweb theory is an economic model that explains why prices might be subject to periodic fluctuations in certain types of markets.',
    ],
    rest: [
      'It describes cyclical supply and demand in a market where the amount produced must be chosen before prices are observed.',
    ],
    restMinutes: 1,
    link: 'https://en.wikipedia.org/wiki/Cobweb_model#Mechanism',
    site: 'Wikipedia',
    licence: 'CC BY-SA 4.0',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    reason: 'gap',
    kind: 'section',
    title: 'Tax incidence: Elasticity',
    source: null,
    track: null,
    article: 'Tax incidence',
    section: 'Elasticity',
    why: 'A field you write about but have never been tested in: Public economics.',
    takeaway: null,
    context: null,
    hook: 'Who legally pays a tax has no effect on who bears it; the less elastic side of the market ends up carrying most of it.',
    summary:
      'The burden of a tax splits between buyers and sellers in proportion to how little each can walk away.',
    example: 'Cigarette taxes fall mostly on smokers, because demand barely moves with price.',
    question: null,
    answer: null,
    depth: 'advanced',
    difficulty: null,
    returning: 'review',
    shown: [
      'Tax incidence is the analysis of the effect of a particular tax on the distribution of economic welfare.',
    ],
    rest: [],
    restMinutes: 0,
    link: 'https://en.wikipedia.org/wiki/Tax_incidence',
    site: 'Wikipedia',
    licence: 'CC BY-SA 4.0',
  },
];

const measuredDraft: CostEstimate = {
  lowMicros: 300_000,
  medianMicros: 400_000,
  highMicros: 760_000,
  runs: 12,
  basis: 'measured',
  per: 'run',
};

const guessedSummary: CostEstimate = {
  lowMicros: 30_000,
  medianMicros: 50_000,
  highMicros: 90_000,
  runs: 2,
  basis: 'guess',
  per: 'run',
};

const perReading: CostEstimate = {
  lowMicros: 12_000,
  medianMicros: 18_000,
  highMicros: 31_000,
  runs: 40,
  basis: 'measured',
  per: 'unit',
};

function CostHintRows() {
  return (
    <div className="space-y-16 pb-16">
      <div className="flex items-center gap-1">
        <Button>Draft cover letter</Button>
        <CostHint estimate={measuredDraft} what="Cost of drafting" defaultOpen />
      </div>
      <div className="flex items-center gap-1">
        <Button variant="secondary">Summarise thread</Button>
        <CostHint estimate={guessedSummary} what="Cost of summarising" defaultOpen />
      </div>
      <div className="flex items-center justify-end gap-1">
        <Button variant="secondary">Grade 12 readings</Button>
        <CostHint estimate={perReading} count={12} what="Cost of grading" align="end" defaultOpen />
      </div>
    </div>
  );
}

/* The spend page's estimates against the ledger, from ranges shaped like the
 * live ledger's in September 2026: one measured row, uncertain rows with and
 * without runs, a per-item row, and two background ones. */
function SpendEstimates() {
  const ranges = new Map<OperationName, MeasuredRange>([
    ['classify-note', { runs: 7, lowMicros: 1_402, medianMicros: 1_538, highMicros: 1_710 }],
    [
      'write-opening-question',
      { runs: 1, lowMicros: 16_065, medianMicros: 16_065, highMicros: 16_065 },
    ],
    ['plan-topic', { runs: 2, lowMicros: 113_270, medianMicros: 400_732, highMicros: 688_194 }],
    ['map-sweep', { runs: 2_127, lowMicros: 1_533, medianMicros: 6_110, highMicros: 12_426 }],
    ['digest-issue', { runs: 91, lowMicros: 1_957, medianMicros: 4_370, highMicros: 16_446 }],
  ]);
  const pick = (names: OperationName[]) =>
    names.map((name) => compareEstimate(name, ranges.get(name)));
  return (
    <EstimatesTable
      foreground={pick([
        'plan-topic',
        'resolve-reference',
        'classify-note',
        'write-opening-question',
        'draft-answer',
      ])}
      background={pick(['map-sweep', 'digest-issue', 'classify-job-email'])}
      days={ESTIMATE_WINDOW_DAYS}
      minRuns={MEASURED_MIN_RUNS}
    />
  );
}

/** The jobs shell with This week in it, for surfaces drawn over a whole page. */
function PreviewShell() {
  return (
    <AppShell
      account="preview"
      module="jobs"
      sections={shellSections}
      settingsHref="/jobs/settings"
      settingsLabel="Job search settings"
      feedbackHref="/dev/bugs"
      displayName="Chris"
      email="chris@example.com"
      isOwner
      counts={{ jobs: '12', shopping: '3', todo: '8' }}
      theme={{ kind: 'written', id: 'paper' }}
      brief={null}
    >
      <TodayLists board={todayBoard} timezone="Europe/London" />
    </AppShell>
  );
}

/** Recommended roles on an ordinary day: two scored, one short of the preferences, one not yet read. */
const recommendedOpening = (over: Partial<OpenSuggestion>): OpenSuggestion => ({
  id: 'op-1',
  kind: 'apply',
  headline: 'Deployment Strategist',
  why: "Own onboarding, workflow design and renewals for private equity and banking deal teams using Mosaic's AI deal models. The $10B take-private work gives you standing with those users.",
  move: "1. Lead with the take-private and acquisition work at EY. 2. Say you want the strategy side of deployment. 3. Find someone on Mosaic's deployment team for a referral.",
  channel: null,
  message: null,
  url: 'https://jobs.ashbyhq.com/mosaic/1',
  location: 'New York City, on-site',
  companyName: 'Mosaic',
  companySlug: 'mosaic',
  personName: null,
  personTitle: null,
  sourceUrl: null,
  searchQuery: null,
  foundIn: "Search for roles like Concourse's, on request",
  contact: null,
  scores: {
    workplace: { value: 'on_site', confidence: 0.95 },
    seniority: { value: 'mid', confidence: 0.6 },
    salary: { value: false, confidence: 0.9 },
    fit: { value: 'partial', confidence: 0.6 },
    red_flags: { value: false, confidence: 0.7 },
    cover_letter: { value: false, confidence: 0.9 },
    duplicate: { value: false, confidence: 1 },
    closeness: { value: 2, confidence: 0.6 },
  },
  scoreNote: {
    fit: { value: 53, unsure: true, reason: "Probably a partial match, from Dash's short summary alone" },
    chance: { value: 30, band: 'medium', unsure: true, reason: '4 of 78 similar reached an interview, 5 still waiting' },
  },
  origin: 'goal',
  postingRead: false,
  compMaxCents: null,
  workMode: 'onsite',
  misses: [],
  createdAt: '2026-09-29T05:02:03Z',
  ...over,
});

const recommendedRoles: OpenSuggestion[] = [
  recommendedOpening({}),
  recommendedOpening({
    id: 'op-2',
    companyName: 'Moment',
    companySlug: null,
    location: 'New York, on-site',
    why: 'Act as the general manager of each customer, from first demo to expansion, with large investment and wealth firms. Strategic and ownership-heavy. Posted at $200K to $300K plus equity and bonus.',
    move: '1. Frame your MBA and startup advising as running an engagement end to end. 2. Show one thing you built. 3. Look for a Yale SOM alum at Moment or its investors.',
    scores: {
      workplace: { value: 'on_site', confidence: 0.95 },
      seniority: { value: 'senior', confidence: 0.6 },
      salary: { value: true, confidence: 0.95 },
      fit: { value: 'partial', confidence: 0.6 },
      red_flags: { value: false, confidence: 0.7 },
      cover_letter: { value: false, confidence: 0.9 },
      duplicate: { value: false, confidence: 1 },
    },
    scoreNote: {
      fit: { value: 56, unsure: true, reason: "Probably a partial match, from Dash's short summary alone" },
      chance: { value: 31, band: 'medium', unsure: true, reason: '4 of 78 similar reached an interview, 5 still waiting' },
    },
    misses: ['On-site, not how you want to work'],
  }),
  recommendedOpening({
    id: 'op-3',
    companyName: 'OpenAI',
    companySlug: 'openai',
    headline: 'Deployment Lead, Financial Services',
    location: 'New York City, hybrid',
    why: 'Work inside banks, asset managers and private capital firms to map workflows and lead AI rollouts. A stretch on seniority, but the same work as Concourse at a larger scale. Posted at $230K to $294K.',
    foundIn: "On OpenAI's own job board",
    origin: 'board',
    postingRead: true,
    scores: {
      workplace: { value: 'hybrid', confidence: 0.95 },
      seniority: { value: 'senior', confidence: 0.9 },
      salary: { value: true, confidence: 0.95 },
      fit: { value: 'partial', confidence: 0.7 },
      red_flags: { value: false, confidence: 0.7 },
      cover_letter: { value: false, confidence: 0.9 },
      duplicate: { value: false, confidence: 1 },
    },
    scoreNote: {
      fit: { value: 41, unsure: true, reason: 'Senior level, above most of your applications' },
      chance: { value: 20, band: 'low', unsure: false, reason: 'Above your usual level, 5 of 88 similar reached an interview' },
    },
  }),
  recommendedOpening({
    id: 'op-4',
    companyName: 'Clay',
    companySlug: 'clay',
    headline: 'Strategic Finance',
    location: 'New York',
    why: 'A strategic finance seat at a growing data company, close to the founders. Matches the FP&A-to-strategy move you wrote about.',
    foundIn: "On Clay's own job board",
    origin: 'board',
    scores: null,
    scoreNote: null,
  }),
];

const recommendedStats: OriginStats[] = [
  { origin: 'search', found: 8, saved: 5, applied: 2, interviews: 0, dismissed: 3, expired: 0 },
  { origin: 'goal', found: 41, saved: 4, applied: 1, interviews: 0, dismissed: 23, expired: 0 },
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
    id: 'jobs-role-posting',
    label: 'Role · Posting',
    module: 'jobs',
    width: 'wide',
    render: () => <RoleDetailPanels {...rolePanels} initialTab="posting" />,
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
    /* The thread on a dev row, in the middle of an exchange. The waiting line
     * is up as well: it is only on screen while a tagged comment is being
     * answered, which is a few seconds nobody can hold still for a shot.
     *
     * In a card, because the thread's ground is a well inside one: every
     * caller draws it there, and the whole point of the ground is the step
     * down from the card behind it. Shot on the page ground alone it would be
     * a panel floating on a bench, which is not a thing the app has. */
    id: 'dev-comment-thread',
    label: 'Comments · a thread on a plan step',
    module: 'dev',
    width: 'narrow',
    render: () => (
      <div className={cn(cardVariants({ padding: 'dense' }), 'space-y-2')}>
        <p className="text-body text-ink">
          The filter and the count disagree on who a step is handed to.
        </p>
        <Thread
          subject={threadRef('step', '00000000-0000-4000-8000-000000000412')}
          turns={commentThread}
          awaitingReply
        />
      </div>
    ),
  },
  {
    /* The same component on a row nobody has written on, which is the state
     * that draws no panel at all: a ground round a single Add a comment button
     * is a section announcing it has nothing in it -- law 1. Worth its own
     * surface because it is what the thread looks like on most rows. */
    id: 'dev-comment-thread-empty',
    label: 'Comments · a row with nothing on it',
    module: 'dev',
    width: 'narrow',
    render: () => (
      <div className={cn(cardVariants({ padding: 'dense' }), 'space-y-2')}>
        <p className="text-body text-ink">
          The filter and the count disagree on who a step is handed to.
        </p>
        <Thread subject={threadRef('step', '00000000-0000-4000-8000-000000000413')} turns={[]} />
      </div>
    ),
  },
  {
    /* The box, open, which is the only state the send control can be looked at
     * in: it is a trigger until it is pressed, so nothing in the app renders
     * it standing open and `composerOpen` is the only way a shot reaches it.
     * Empty, so the send control is in its disabled state and the line under
     * the words says a note reaches nobody until it is tagged. */
    id: 'dev-comment-thread-composer',
    label: 'Comments · the box you send from',
    module: 'dev',
    width: 'narrow',
    render: () => (
      <div className={cn(cardVariants({ padding: 'dense' }), 'space-y-2')}>
        <p className="text-body text-ink">
          The filter and the count disagree on who a step is handed to.
        </p>
        <Thread
          subject={threadRef('step', '00000000-0000-4000-8000-000000000414')}
          turns={commentThread}
          composerOpen
        />
      </div>
    ),
  },
  {
    /* The dev plan as a list, every feature unfolded (plan #993). What a
     * change to the plan's rows is checked against: shot before and after,
     * the two should not differ. */
    id: 'dev-plan-tree',
    label: 'Plan · the tree, unfolded',
    module: 'dev',
    width: 'page',
    render: () => <PlanTreeSurface />,
  },
  {
    /* The same plan with its rows opened, for the panel behind a row: the
     * detail, the questions, what it waits on and the thread. */
    id: 'dev-plan-opened',
    label: 'Plan · rows opened',
    module: 'dev',
    width: 'page',
    render: () => <PlanOpenedSurface />,
  },
  {
    /* A step the design critic stopped after round 3 (plan #1610): the last
     * fixes and shots for each surface, one with its shots uploaded and one
     * without, and accept or say what to change. */
    id: 'dev-plan-critic-stop',
    label: 'Plan · a screen the critic stopped',
    module: 'dev',
    width: 'page',
    render: () => <PlanCriticStopSurface />,
  },
  {
    /* A goal's steps, drawn with the plan's shared row (plan #982), beside
     * the plan's own shots so the two can be compared. */
    id: 'goals-steps-tree',
    label: 'Goal · the steps',
    module: 'goals',
    width: 'page',
    render: () => <GoalTreeSurface />,
  },
  {
    /* The same goal with every step opened: detail, Needs, questions, what
     * it waits on, the goal's own slots and the thread. */
    id: 'goals-steps-opened',
    label: 'Goal · steps opened',
    module: 'goals',
    width: 'page',
    render: () => <GoalOpenedSurface />,
  },
  {
    /* The Goals home on an ordinary week (plans #1043, #1077): five things
     * today and one folded under them, four goals with their statuses (one
     * checked days ago, one with no steps), and a result Dash wrote. */
    id: 'goals-home',
    label: 'Goals · home',
    module: 'goals',
    width: 'page',
    render: () => <GoalsHomeSurface />,
  },
  {
    /* Three areas and their goals, edited where they stand. */
    id: 'goals-all',
    label: 'Goals · all goals',
    module: 'goals',
    width: 'page',
    render: () => <GoalsAllSurface />,
  },
  {
    /* The top of a goal page with every section holding something: the
     * Claude line, the number and its readings, one Learn goal linked. */
    id: 'goals-page-top',
    label: 'Goal · the top of the page',
    module: 'goals',
    width: 'page',
    render: () => <GoalTopSurface />,
  },
  {
    /* A file Claude wrote (core.files): the summary, then a table, a list
     * and a caveats section in the body. */
    id: 'goals-file',
    label: 'Goals · a file',
    module: 'goals',
    width: 'page',
    render: () => <FileSurface />,
  },
  {
    /* A goal just added: the Claude line and the row of add lines. */
    id: 'goals-page-bare',
    label: 'Goal · a bare goal',
    module: 'goals',
    width: 'page',
    render: () => <GoalBareSurface />,
  },
  {
    /* The bare goal's link line pressed: the picker for a first link. */
    id: 'goals-page-linking',
    label: 'Goal · linking the first Learn goal',
    module: 'goals',
    width: 'page',
    render: () => <GoalLinkingSurface />,
  },
  {
    /* An information step holding one record: two asked values, the rest
     * folded under Other fields. */
    id: 'goals-info-one',
    label: 'Goal · a one-record information step',
    module: 'goals',
    width: 'page',
    render: () => <InformationOneSurface />,
  },
  {
    /* A list step: three loans of nineteen fields, four of them asked. */
    id: 'goals-info-list',
    label: 'Goal · a list information step',
    module: 'goals',
    width: 'page',
    render: () => <InformationListSurface />,
  },
  {
    /* The same list with one row's other fields showing and a balance
     * being changed in its cell. */
    id: 'goals-info-list-open',
    label: 'Goal · a list step, other fields and an editor open',
    module: 'goals',
    width: 'page',
    render: () => (
      <InformationListSurface
        seam={{ openRow: 'loan-student', editing: { recordId: 'loan-car', key: 'balance' } }}
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
    id: 'jobs-recommended-roles',
    label: 'Roles · Recommended roles',
    module: 'jobs',
    width: 'wide',
    render: () => (
      <RecommendedRoles
        suggestions={recommendedRoles}
        stats={recommendedStats}
        searchCostMicros={4_200_000}
        searchLine={{ running: false, tone: 'plain', text: 'The search 2 hours ago found 3 new roles. Read 58 job boards, 12 postings worth a look.' }}
      />
    ),
  },
  {
    id: 'jobs-roles-table',
    label: 'Roles · The table',
    module: 'jobs',
    width: 'wide',
    render: () => <RolesTable rows={pipelineRows} sorts={rolesSortChoices} />,
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
        feedEventHref={(id) => `/todo/calendar?feedEvent=${id}`}
      />
    ),
  },
  {
    /* A subscribed appointment, opened (plan #1374): what the organiser wrote,
     * the calendar it came from, and one task already about this date of it. */
    id: 'todo-feed-event',
    label: 'Calendar · A subscribed appointment',
    module: 'todo',
    width: 'narrow',
    render: () => (
      <FeedEventCard
        detail={{
          feedName: 'Work',
          event: {
            id: '00000000-0000-4000-8000-000000001374',
            feedId: '00000000-0000-4000-8000-000000000f01',
            title: 'Quarterly planning',
            body: 'Bring the Q4 numbers.\nAgenda to follow.',
            location: 'Room 4.02 / https://meet.example.com/q4-plan',
            startsOn: null,
            endsOn: null,
            startsAt: '2026-09-10T09:00:00.000Z',
            endsAt: '2026-09-10T10:30:00.000Z',
            createdAt: '2026-09-01T08:00:00.000Z',
          },
        }}
        view="month"
        anchor={CALENDAR_TODAY}
        timezone="Europe/London"
        tasks={[
          {
            id: 'feed-task-1',
            title: 'Pull the Q4 numbers together',
            body: null,
            status: 'open',
            dueOn: '2026-09-09',
            dueAt: null,
            pinned: false,
            snoozedUntil: null,
            completedAt: null,
            createdAt: '2026-09-02T08:00:00.000Z',
            position: null,
            parentId: null,
          },
        ]}
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
    /* Editing a note in place (plan #1425): at rest, the note with Edit beside
     * its title; the editor is the same component after a press. */
    id: 'vault-note-edit',
    label: 'Note · Edit button',
    module: 'vault',
    width: 'narrow',
    render: () => (
      <NoteEdit
        notePath="Work/Nightly close.md"
        body={noteMarkdown}
        blobSha="preview"
        heading={
          <header>
            <h1 className="font-display text-title font-semibold tracking-tight text-ink">
              Nightly close
            </h1>
            <p className="mt-1 text-ui text-ink-muted">Work/ · updated 30 Aug 2026</p>
          </header>
        }
        properties={<NoteProperties frontmatter={noteFrontmatter} />}
      >
        <NoteBody markdown={noteMarkdown} />
      </NoteEdit>
    ),
  },
  {
    /* The editor open, and the two refusals that come with a way forward:
     * changed in Obsidian (reload) and a token that cannot write (settings). */
    id: 'vault-note-editing',
    label: 'Note · Editing, and a refused save',
    module: 'vault',
    width: 'narrow',
    render: () => <NoteEditingPreview body={noteMarkdown} />,
  },
  {
    /* A note's embedded files (plan #1302): an image, a sized one, a PDF, a
     * recording, and the four ways a file can be unavailable. The images are
     * drawn from data URLs here; on the page they come through the signed
     * /vault/attachment route. */
    id: 'vault-note-attachments',
    label: 'Note · Embedded files',
    module: 'vault',
    width: 'narrow',
    render: () => (
      <NoteBody
        markdown={toStandardMarkdown(attachmentNote, { index: buildLinkIndex([]), hrefFor: noteHref })}
        notePath="Home/Moving flat.md"
        attachments={buildAttachmentIndex(attachmentRows)}
        hrefForAttachment={(entry) => attachmentPictures[entry.id] ?? '#'}
      />
    ),
  },
  {
    /* The Education tab with nothing on it yet (plan #1308): the empty state
     * says what to upload. */
    id: 'vault-education-empty',
    label: 'Education · Empty',
    module: 'vault',
    width: 'page',
    render: () => (
      <>
        <PageHeader title="Education" />
        <AddTranscript empty />
      </>
    ),
  },
  {
    /* Choosing a transcript or pasting its text, before Dash reads it. */
    id: 'vault-education-upload',
    label: 'Education · Upload',
    module: 'vault',
    width: 'page',
    render: () => (
      <>
        <PageHeader title="Education" />
        <EducationUploadPreview />
      </>
    ),
  },
  {
    /* The courses Dash read, to check before saving: a school it found, a
     * course with no grade, and a transfer course showing its own school. */
    id: 'vault-education-check',
    label: 'Education · Check before saving',
    module: 'vault',
    width: 'page',
    render: () => (
      <>
        <PageHeader title="Education" />
        <EducationCheckPreview />
      </>
    ),
  },
  {
    /* Saved courses by school and then by term, newest first, with the
     * transcripts each school issued. */
    id: 'vault-education-list',
    label: 'Education · Courses by school and term',
    module: 'vault',
    width: 'page',
    render: () => (
      <>
        <PageHeader title="Education" description="9 courses from 2 transcripts" />
        <AddTranscript empty={false} />
        {educationGroups.map((group) => (
          <SchoolCourses key={group.school} group={group} courseCounts={educationCounts} />
        ))}
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
    /* Learn now as a deck: one card, the three swipes at its foot. Nothing
     * here is recorded; the swipes only reach the server from the real page. */
    id: 'learn-now-deck',
    label: 'Now · One card at a time',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnNowFeed first={deckCards} ready={20} low={10} />,
  },
  {
    /* The courses fold on Learn's Tracks page with no transcript saved: it
     * points to the vault's Education tab (plan #1391). */
    id: 'learn-courses-empty',
    label: 'Tracks · Courses, none saved',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnCoursesEmptyPreview />,
  },
  {
    /* Courses by school and term, one read into a track, one whose track
     * was removed, each with its read button (plan #1391). */
    id: 'learn-courses-list',
    label: 'Tracks · Courses by school and term',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnCoursesListPreview />,
  },
  {
    /* One course being checked: its term and grade, the track picker, an
     * idea the track already holds, and the ticks (plan #1391). */
    id: 'learn-course-check',
    label: 'Tracks · Checking a course',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnCourseCheckPreview />,
  },
  {
    /* A Learn-area goal's Learning section: how well you want to know it,
     * its plan and the Practise link (plan #1491, from Learn's old Goals tab). */
    id: 'learn-goals-list',
    label: 'Goals · A learning goal, with Practise',
    module: 'learn',
    width: 'narrow',
    render: () => <LearnGoalsPreview />,
  },
  {
    /* Practice Flow's filter with Goals only chosen, and the line a goal's
     * Practise link opens on in its place (plan #1387). */
    id: 'learn-flow-scope',
    label: 'Practice Flow · The filter and a goal focus',
    module: 'learn',
    width: 'narrow',
    render: () => <FlowScopePreview />,
  },
  {
    /* The chain a subject reads as: the doors it turns on, then everything
     * downstream of them. The size difference is the surface. */
    id: 'learn-subject-chain',
    label: 'Subject · Doors and what follows',
    module: 'learn',
    width: 'narrow',
    render: () => (
      <ConceptList concepts={subjectConcepts} nextId="k1" subjectId="s1" timezone="Europe/London" />
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

  {
    /* The shared display control and the shared group header, before any page
     * uses either. Both at once because they are two halves of one idea: the
     * panel says how the list is arranged and the header is where a grouping
     * proves it is a grouping rather than a reordering. */
    id: 'shell-display-options',
    label: 'Display options · Control and group headers',
    module: 'shopping',
    width: 'wide',
    render: () => <SharedDisplayOptions />,
  },

  {
    /* The top bar's search field on its own. It is a button drawn as a
     * field: pressing it opens the search box on everything you own (plan
     * #1363), which here does nothing because the shell is not around it.
     * In a workspace its chip reads Everything and offers the workspace
     * (plan #1364). */
    id: 'shell-search-bar',
    label: 'Top bar · Search field',
    module: 'jobs',
    width: 'narrow',
    render: () => (
      <div className="py-4">
        <SearchBarSurface />
      </div>
    ),
  },

  {
    /* The one capture box (plan #1581) that the plus in the top bar and ⌥C
     * open: the line under the field while a sentence is typed, the chips
     * when Dash is not sure, and where three filed things went. */
    id: 'shell-capture',
    label: 'Top bar · Capture anything',
    module: 'todo',
    width: 'narrow',
    render: () => <CaptureBoxSurface />,
  },

  {
    /* Ask Dash (plan #1090): the sheet the Dash button in the top bar opens,
     * over the same shell as below, first on a new question with the earlier
     * ones under it, then with an answer and the rows it used. Fixtures
     * stand in for the server actions (ask-surfaces.tsx). */
    id: 'ask-dash-new',
    label: 'Ask Dash · A new question',
    module: 'jobs',
    width: 'page',
    render: () => (
      <AskDashSurface open>
        <PreviewShell />
      </AskDashSurface>
    ),
  },
  {
    id: 'ask-dash-answer',
    label: 'Ask Dash · An answer with its rows',
    module: 'jobs',
    width: 'page',
    render: () => (
      <AskDashSurface open question="What did I spend on eBay flips this quarter?">
        <PreviewShell />
      </AskDashSurface>
    ),
  },
  {
    /* An answer that failed (plan #1337): the question was kept, the answer
     * was not, and Dash's mark shows failed with the error beside it where
     * the working line was. */
    id: 'ask-dash-failed',
    label: 'Ask Dash · An answer that failed',
    module: 'jobs',
    width: 'page',
    render: () => (
      <AskDashSurface open question={FAILING_QUESTION}>
        <PreviewShell />
      </AskDashSurface>
    ),
  },
  {
    /* The page Dash will be told (plan #1272): opened over a goal, the chip
     * above the question box names the goal, with an × to leave it out. */
    id: 'ask-dash-page',
    label: 'Ask Dash · The page it will be told',
    module: 'goals',
    width: 'page',
    render: () => (
      <AskDashSurface open page={TRIP_GOAL}>
        <PreviewShell />
      </AskDashSurface>
    ),
  },
  {
    /* A change Dash proposes (plan #1190): asked to add something, the answer
     * carries a card per change with Confirm and Decline, and nothing is
     * written until one is pressed. */
    id: 'ask-dash-proposal',
    label: 'Ask Dash · Changes to confirm',
    module: 'jobs',
    width: 'page',
    render: () => (
      <AskDashSurface open question="Add a todo to call the dentist on Friday, and a step to book the hygienist">
        <PreviewShell />
      </AskDashSurface>
    ),
  },
  {
    /* The same cards reopened later, as /ask/<ref> and the sheet draw them:
     * done with a link and Undo, declined, undone, and one still waiting. */
    id: 'ask-dash-changes',
    label: 'Ask Dash · Changes reopened',
    module: 'jobs',
    width: 'page',
    render: () => <AskChangesSurface />,
  },
  {
    /* The Ask page's list of changes Dash made (plan #1191): one of each kind
     * newest first, one undone, Undo on the step refused with its reason. */
    id: 'ask-made-changes',
    label: 'Ask · Changes Dash made',
    module: 'jobs',
    width: 'page',
    render: () => <AskMadeChangesSurface />,
  },

  {
    /* Learn's clip player (plan #1400): three clips queued, before the first
     * tap. Full screen below lg, in the page pane above. Fixtures in
     * clip-surfaces.tsx. */
    id: 'learn-clips',
    label: 'Learn · Clips',
    module: 'learn',
    width: 'page',
    render: () => <ClipStreamSurface />,
  },
  {
    /* Clips before any are cut. */
    id: 'learn-clips-empty',
    label: 'Learn · Clips, none cut yet',
    module: 'learn',
    width: 'page',
    render: () => <ClipsEmptySurface />,
  },
  {
    /* Dev's Inspiration tab (plan #1412), by video: a point two videos made,
     * one already in the plan, a video with no transcript, and the dismissed
     * fold. Fixtures in inspiration-surfaces.tsx. */
    id: 'dev-inspiration',
    label: 'Dev · Inspiration, by video',
    module: 'dev',
    width: 'page',
    render: () => <InspirationByVideoSurface />,
  },
  {
    /* The same takeaways as one list, each naming every video it came from. */
    id: 'dev-inspiration-list',
    label: 'Dev · Inspiration, one list',
    module: 'dev',
    width: 'page',
    render: () => <InspirationListSurface />,
  },
  {
    /* Before the playlist has been read. */
    id: 'dev-inspiration-unread',
    label: 'Dev · Inspiration, not read yet',
    module: 'dev',
    width: 'page',
    render: () => <InspirationUnreadSurface />,
  },
  {
    /* Dev's Posts tab (plan #1419): two drafts waiting, one a thread with a
     * post past 280, then the posted and dropped folds. Fixtures in
     * posts-surfaces.tsx. */
    id: 'dev-posts',
    label: 'Dev · Posts',
    module: 'dev',
    width: 'page',
    render: () => <PostsSurface />,
  },
  {
    /* The first press: Dash drafting, nothing written yet. */
    id: 'dev-posts-drafting',
    label: 'Dev · Posts, while Dash drafts',
    module: 'dev',
    width: 'page',
    render: () => <PostsDraftingSurface />,
  },
  {
    /* The home page's Watching section (plan #1295): a watch that fired, one
     * reporting only, and one whose page stopped reading. Fixtures in
     * watching-surfaces.tsx. */
    id: 'home-watching',
    label: 'Home · What Dash is watching',
    module: 'goals',
    width: 'wide',
    render: () => <WatchingSurface />,
  },
  {
    /* The timeline (plan #1118): the months newest first, the newest open,
     * each with its count per kind on the line that folds it. Fixtures in
     * timeline-surfaces.tsx. */
    id: 'timeline-page',
    label: 'Timeline · What you did, month by month',
    module: 'goals',
    width: 'page',
    render: () => <TimelineSurface />,
  },
  {
    /* The year in review (plan #1121): what Dash wrote, each paragraph with
     * its rows, then every number the paragraphs may use. Fixtures in
     * timeline-surfaces.tsx. */
    id: 'timeline-year',
    label: 'Timeline · The year in review',
    module: 'goals',
    width: 'page',
    render: () => <YearReviewSurface />,
  },

  {
    /* The whole shell, which no other surface shows: the sidebar, the top bar,
     * and a real page inside them. Every other entry here is a panel on the
     * page's ground, so the chrome -- where most of the app's character
     * actually lives -- had never been photographed at all.
     *
     * The props are the ones app/jobs/(app)/layout.tsx passes, copied rather
     * than imported because that layout reads a session and a database and
     * this route reads neither. */
    id: 'shell-full',
    label: 'The shell · Sidebar, top bar and a page',
    module: 'jobs',
    width: 'page',
    render: () => (
      <AppShell
        account="preview"
        module="jobs"
        sections={shellSections}
        settingsHref="/jobs/settings"
        settingsLabel="Job search settings"
        feedbackHref="/dev/bugs"
        displayName="Chris"
        email="chris@example.com"
        // The picture is of the owner's shell, which is the one with every
        // workspace in the switcher.
        isOwner
        counts={{ jobs: '12', shopping: '3', todo: '8' }}
        theme={{ kind: 'written', id: 'paper' }}
        brief={null}
      >
        <TodayLists board={todayBoard} timezone="Europe/London" />
      </AppShell>
    ),
  },

  {
    id: 'news-issue-digest',
    label: 'News · Issue summary and stories',
    module: 'news',
    width: 'page',
    render: () => <IssueView {...issueBase} />,
  },
  {
    id: 'news-issue-digest-no-pictures',
    label: 'News · Issue summary with pictures off',
    module: 'news',
    width: 'page',
    render: () => <IssueView {...issueBase} pictures={false} picturesHref="/news/i/issue-1" />,
  },
  {
    id: 'news-issue-essay',
    label: 'News · Single-essay issue summary',
    module: 'news',
    width: 'page',
    render: () => <IssueView {...issueEssay} />,
  },
  {
    id: 'news-issue-original',
    label: 'News · Issue original email',
    module: 'news',
    width: 'page',
    render: () => (
      <IssueView
        {...issueBase}
        showDigest={false}
        html={issueFailed.html}
        pictures={false}
        blockedImages={1}
      />
    ),
  },
  {
    id: 'news-issue-failed',
    label: 'News · Issue whose summary failed',
    module: 'news',
    width: 'page',
    render: () => <IssueView {...issueFailed} />,
  },
  {
    id: 'news-quick-story',
    label: 'News · Quick read story card',
    module: 'news',
    width: 'page',
    interaction: {
      kind: 'swipe',
      target: '[data-quick-swipe]',
      direction: 'left',
      shows: 'The card follows the finger left, then springs off as the essay behind it comes in.',
    },
    deck: { next: '#quick-read-next button[type="submit"]', item: '[data-quick-swipe]' },
    // The essay drawn behind it, so Next shows it at once (note 452a90d9).
    render: () => (
      <QuickReadView
        {...quickStory}
        upNext={{
          card: quickEssay.card!,
          arrived: '20 Sep, 09:02',
          saved: false,
          issueHref: '/news/i/issue-2',
        }}
      />
    ),
  },
  {
    /* The same card inside the News shell (plan #1446), so a phone shot shows
     * the top bar, the dock, and Back and Next held just above the dock. The
     * entry above has no shell, so its row sits over nothing. */
    id: 'news-quick-in-shell',
    label: 'News · Quick read inside the shell',
    module: 'news',
    width: 'page',
    render: () => (
      <div data-workspace="news">
        <AppShell
          account="preview"
          module="news"
          sections={[
            { href: '/news', label: 'Quick read', icon: 'quickRead', exact: true },
            { href: '/news/all', label: 'Newsletters', icon: 'newsletters', exact: true },
            { href: '/news/saved', label: 'Saved', icon: 'saved', exact: true },
          ]}
          settingsHref="/news/settings"
          settingsLabel="News settings"
          displayName="Chris"
          email="chris@example.com"
          isOwner
          counts={{ jobs: '12', shopping: '3', todo: '8' }}
          theme={{ kind: 'written', id: 'paper' }}
          brief={null}
        >
          <QuickReadView {...quickStory} />
        </AppShell>
      </div>
    ),
  },
  {
    id: 'news-quick-essay',
    label: 'News · Quick read single-essay card',
    module: 'news',
    width: 'page',
    render: () => <QuickReadView {...quickEssay} />,
  },
  {
    id: 'news-quick-page',
    label: 'News · Quick read page on a laptop',
    module: 'news',
    width: 'page',
    render: () => <QuickReadView {...quickPageView} />,
  },
  {
    id: 'news-quick-page-full',
    label: 'News · A full Quick read page, every story with a picture',
    module: 'news',
    width: 'page',
    render: () => <QuickReadView {...quickFullPage} />,
  },
  {
    id: 'news-quick-caught-up',
    label: 'News · Quick read caught up',
    module: 'news',
    width: 'page',
    render: () => <QuickReadView {...quickStory} card={null} arrived={null} issueHref={null} />,
  },
  {
    id: 'news-story-grid',
    label: 'News · Story grid with pictures',
    module: 'news',
    width: 'page',
    render: () => <StoryGrid stories={gridStories} pictures />,
  },
  {
    id: 'news-story-grid-no-pictures',
    label: 'News · Story grid with no pictures',
    module: 'news',
    width: 'page',
    render: () => (
      <StoryGrid stories={gridStories.map((story) => ({ ...story, image: null }))} pictures />
    ),
  },
  {
    /* Shopping's Recurring page (plan #1126): the monthly figure, what is
     * coming up with a price rise marked, and what stopped charging. */
    id: 'shopping-recurring',
    label: 'Shopping · Recurring payments',
    module: 'shopping',
    width: 'page',
    render: () => <RecurringSurface />,
  },
  {
    id: 'shopping-recurring-empty',
    label: 'Shopping · Recurring with nothing found',
    module: 'shopping',
    width: 'page',
    render: () => <RecurringEmptySurface />,
  },
  {
    id: 'news-saved',
    label: 'News · Saved stories',
    module: 'news',
    width: 'page',
    render: () => <SavedView {...savedStories} />,
  },
  {
    id: 'news-saved-empty',
    label: 'News · Saved with nothing saved',
    module: 'news',
    width: 'page',
    render: () => <SavedView stories={[]} />,
  },

  {
    /* The $ hint beside three paid buttons: one with enough runs to give a
     * range, one that is a guess, and one priced per item and multiplied by
     * the batch. Each starts open so the shot shows the figure as well as the
     * mark; in the app it opens on hover, focus or a press. The rows are
     * spaced for the popup that hangs below each. */
    id: 'core-cost-hint',
    label: 'Spend · The $ hint beside a paid button',
    module: 'learn',
    width: 'narrow',
    render: () => <CostHintRows />,
  },
  {
    /* /account/spend: every operation's estimate beside its thirty-day median.
     * At phone width the rows stack into label/value pairs. */
    id: 'core-spend-estimates',
    label: 'Spend · Estimates against actual spend',
    module: 'learn',
    width: 'page',
    render: () => <SpendEstimates />,
  },

  /* The three shared motion pieces (plan #1550), each on the /dev/ui demo
   * that shows it, so a recording keeps the strip of it playing. */
  {
    id: 'dev-motion-travel',
    label: 'Motion · Travel, a chip flying to its place',
    module: 'dev',
    width: 'narrow',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="travel"]',
      shows: 'A chip carrying the first words leaves "capture", crosses, and fades as it lands on "todo".',
    },
    render: () => (
      <div className={cardVariants({ padding: 'standard' })}>
        <TravelDemo />
      </div>
    ),
  },
  {
    id: 'dev-motion-settle',
    label: 'Motion · Settle, a row springing into place',
    module: 'dev',
    width: 'narrow',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="settle"]',
      shows: 'A second row rises into the list with a little give, and "todo" swells once with "Todo · Today" beside it.',
    },
    render: () => (
      <div className={cardVariants({ padding: 'standard' })}>
        <SettleDemo />
      </div>
    ),
  },
  {
    id: 'dev-motion-clear',
    label: 'Motion · Clear, the last item leaving',
    module: 'dev',
    width: 'narrow',
    interaction: {
      kind: 'completion',
      target: '[data-motion-demo="clear"]',
      shows: 'The last item leaves with a puff and the day\'s sigil draws in cell by cell in its place.',
    },
    render: () => (
      <div className={cardVariants({ padding: 'standard' })}>
        <ClearDemo items={['Return the kettle']} />
      </div>
    ),
  },

  /* The day closing on the agenda (plan #1556): played by ticking the last
   * thing due today, and as a page that loads with the day already closed. */
  {
    id: 'todo-day-close',
    label: 'Todo · The day closing',
    module: 'todo',
    width: 'narrow',
    interaction: {
      kind: 'completion',
      target: '[data-motion-demo="day-close"]',
      shows:
        'The two done tasks spring from their rows into a pile that folds shut, the day\'s sigil draws in beside it, and "You finished all 2 things due today." arrives last.',
    },
    render: () => (
      <div className={cardVariants({ padding: 'standard' })}>
        <DayCloseDemo
          due={['Return the kettle', 'Book the dentist']}
          alreadyDone={['Return the kettle']}
        />
      </div>
    ),
  },
  {
    id: 'todo-day-closed',
    label: 'Todo · A day already closed',
    module: 'todo',
    width: 'narrow',
    render: () => (
      <DayClosed
        closed
        seed="preview:day-closed"
        done={[
          { id: 'a', title: 'Renew the parking permit' },
          { id: 'b', title: 'Book the dentist' },
          { id: 'c', title: 'Return the kettle' },
          { id: 'd', title: 'Pay the window cleaner' },
        ]}
      />
    ),
  },

  /* The end of Quick read (plan #1557): played by passing the last story,
   * and as a page that loads already caught up. */
  {
    id: 'news-quick-got-through',
    label: 'News · The end of Quick read',
    module: 'news',
    width: 'narrow',
    interaction: {
      kind: 'completion',
      target: '[data-motion-demo="got-through"]',
      shows:
        'The last story goes, the day\'s sigil draws in, and the card below lifts in with Read counting up to 9 and Skipped to 4, the longest-read story and the two newsletters due next.',
    },
    render: () => (
      <div className={cardVariants({ padding: 'standard' })}>
        <GotThroughDemo stories={['Rail strike called off']} />
      </div>
    ),
  },
  {
    id: 'news-quick-got-through-loaded',
    label: 'News · Quick read already finished',
    module: 'news',
    width: 'narrow',
    render: () => (
      <GotThrough
        done
        summary={{
          read: 14,
          skipped: 6,
          longest: { headline: 'Why the rail strike was called off at midnight', held: '4 minutes' },
          due: [{ from: 'The Morning Letter', when: 'tomorrow around 6:00\u00a0AM' }],
        }}
      />
    ),
  },

  /* Home's first visit of the day and a finished day (plan #1558): played
   * from the gallery demo, and at rest with the day already finished. */
  {
    id: 'home-arrival',
    label: 'Home · The first visit of the day',
    module: 'dev',
    width: 'narrow',
    interaction: {
      kind: 'press',
      target: '[data-motion-demo="home-arrival"]',
      shows:
        'The greeting, the date, the brief line and the Today card each rise in a beat after the one before, all settled by about three quarters of a second.',
    },
    render: () => (
      <div className={cardVariants({ padding: 'standard' })}>
        <HomeArrivalDemo />
      </div>
    ),
  },
  {
    id: 'home-finished-day',
    label: 'Home · A finished day',
    module: 'dev',
    width: 'narrow',
    interaction: {
      kind: 'completion',
      target: '[data-motion-demo="home-finished"]',
      shows: "The Today card goes, and the day's sigil draws in cell by cell beside the date.",
    },
    render: () => (
      <div className={cardVariants({ padding: 'standard' })}>
        <HomeArrivalDemo />
      </div>
    ),
  },
  {
    id: 'home-finished-day-rest',
    label: 'Home · A day already finished',
    module: 'dev',
    width: 'narrow',
    render: () => (
      <div className={cardVariants({ padding: 'standard' })}>
        <HomeArrivalDemo finished />
      </div>
    ),
  },

  /* The pages outside the shell, and /open's not-found (plan #1599).
   * Fixtures in public-surfaces.tsx. */
  {
    id: 'front-door',
    label: 'Front door · The public homepage',
    module: 'dev',
    width: 'screen',
    render: () => <FrontDoorSurface />,
  },
  {
    id: 'auth-login',
    label: 'Sign in · After Google sign-in failed',
    module: 'dev',
    width: 'screen',
    render: () => <LoginSurface />,
  },
  {
    id: 'auth-signup',
    label: 'Sign up',
    module: 'dev',
    width: 'screen',
    render: () => <SignupSurface />,
  },
  {
    id: 'auth-reset-password',
    label: 'Sign in · Reset your password',
    module: 'dev',
    width: 'screen',
    render: () => <ResetPasswordSurface />,
  },
  {
    id: 'auth-code-error',
    label: 'Sign in · A link that did not work',
    module: 'dev',
    width: 'screen',
    render: () => <AuthCodeErrorSurface />,
  },
  {
    id: 'auth-consent',
    label: 'Sign in · An app asking to connect',
    module: 'dev',
    width: 'screen',
    render: () => <ConsentSurface />,
  },
  {
    id: 'legal-privacy',
    label: 'Privacy policy',
    module: 'dev',
    width: 'screen',
    render: () => <PrivacySurface />,
  },
  {
    id: 'legal-terms',
    label: 'Terms',
    module: 'dev',
    width: 'screen',
    render: () => <TermsSurface />,
  },
  {
    id: 'onboarding-welcome',
    label: 'Onboarding · Welcome',
    module: 'shopping',
    width: 'screen',
    render: () => <OnboardingWelcomeSurface />,
  },
  {
    id: 'onboarding-gmail',
    label: 'Onboarding · Gmail, after access was refused',
    module: 'shopping',
    width: 'screen',
    render: () => <OnboardingGmailSurface />,
  },
  {
    id: 'share-form',
    label: 'Shared list · Keep, sell or give away',
    module: 'shopping',
    width: 'screen',
    render: () => <ShareFormSurface />,
  },
  {
    id: 'open-missing',
    label: 'Open · A link to a row that has gone',
    module: 'dev',
    width: 'page',
    render: () => <OpenMissingSurface />,
  },

  /* The account, the week review and the Dev tabs (plan #1600). Fixtures
   * in dev-page-surfaces.tsx, week-surfaces.tsx and plan-surfaces.tsx. */
  {
    id: 'account',
    label: "Account · Settings across every workspace",
    module: 'dev',
    width: 'page',
    render: () => <AccountSurface />,
  },
  {
    id: 'home-week',
    label: "Home · The week in review",
    module: 'goals',
    width: 'page',
    render: () => <WeekReviewSurface />,
  },
  {
    id: 'home-week-none',
    label: "Home · The week in review, before the first",
    module: 'goals',
    width: 'page',
    render: () => <WeekReviewNoneSurface />,
  },
  {
    id: 'dev-bugs',
    label: "Dev · Bugs and requests",
    module: 'dev',
    width: 'page',
    render: () => <DevBugsSurface />,
  },
  {
    id: 'dev-changelog',
    label: "Dev · Changelog",
    module: 'dev',
    width: 'page',
    render: () => <DevChangelogSurface />,
  },
  {
    id: 'dev-ideas',
    label: "Dev · Ideas",
    module: 'dev',
    width: 'page',
    render: () => <DevIdeasSurface />,
  },
  {
    id: 'dev-project-plan',
    label: "Dev · A project's plan",
    module: 'dev',
    width: 'page',
    render: () => <ProjectPlanSurface />,
  },
  {
    id: 'dev-raised',
    label: "Dev · Home, what is waiting on you",
    module: 'dev',
    width: 'page',
    render: () => <DevRaisedSurface />,
  },
  {
    id: 'dev-specs',
    label: "Dev · Specs",
    module: 'dev',
    width: 'page',
    render: () => <DevSpecsSurface />,
  },
  {
    id: 'dev-spec',
    label: "Dev · One spec",
    module: 'dev',
    width: 'page',
    render: () => <DevSpecSurface />,
  },
  {
    id: 'dev-ui-review',
    label: "Dev · UI review",
    module: 'dev',
    width: 'page',
    render: () => <DevUiReviewSurface />,
  },
  {
    id: 'dev-usage',
    label: "Dev · Usage",
    module: 'dev',
    width: 'page',
    render: () => <DevUsageSurface />,
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
