import { JobsOnboardingSteps } from '@/app/jobs/(onboarding)/onboarding/onboarding-steps';
import { ActivityView } from '@/app/jobs/(app)/activity/activity-view';
import { AnalyticsView } from '@/app/jobs/(app)/analytics/analytics-view';
import { AnswersView, type AnswerRow } from '@/app/jobs/(app)/answers/answers-view';
import { ThoughtsView } from '@/app/jobs/(app)/thoughts/thoughts-view';
import { CaseView, type CasePage } from '@/app/jobs/p/[slug]/case-view';
import { MailView } from '@/app/mail/[id]/mail-view';
import type { Activity, ActivityEntry } from '@/lib/jobs/activity/load';
import type {
  ApplicationSource,
  ApplicationStatus,
  FunnelApplication,
  RejectionStage,
} from '@/lib/jobs/pipeline';
import type { GmailMessageContent } from '@/lib/email/providers/types';

/**
 * The remaining job search pages and the mail reader in the surface gallery
 * (plan #1601), each drawn by the view its page hands its reads to, from
 * fixtures shaped like the live rows. No clock is read: every date is written
 * out, and Analytics is measured at a fixed instant.
 */

const ZONE = 'Europe/London';

// ---- Activity ---------------------------------------------------------------

function entry(
  over: Partial<ActivityEntry> & Pick<ActivityEntry, 'id' | 'at' | 'label'>,
): ActivityEntry {
  return {
    source: 'email',
    subject: null,
    tone: 'muted',
    detail: null,
    roleId: null,
    ...over,
  };
}

const activity: Activity = {
  runs: [
    {
      id: 'sync-1',
      type: 'incremental',
      status: 'succeeded',
      messagesSeen: 37,
      startedAt: '2026-10-03T06:00:00Z',
      finishedAt: '2026-10-03T06:02:10Z',
      error: null,
    },
  ],
  highlights: { days: 7, newRoles: 3, movedForward: 2, rejections: 2, closedOut: 4 },
  lastSweepAt: '2026-10-03T02:00:00Z',
  entries: [
    entry({
      id: 'e1',
      at: '2026-10-03T06:01:00Z',
      label: 'Interview booked',
      subject: 'Northbridge Capital · Quantitative Researcher, Systematic Macro',
      tone: 'good',
      detail: 'Hiring manager call on Thursday 8 October at 3:00 PM.',
      roleId: 'r1',
    }),
    entry({
      id: 'e2',
      at: '2026-10-03T06:01:00Z',
      label: 'Rejected',
      subject: 'Halden & Co · FP&A Manager',
      tone: 'bad',
      detail: 'After the resume review.',
      roleId: 'r2',
    }),
    entry({
      id: 'e3',
      at: '2026-10-02T06:00:00Z',
      source: 'auto',
      label: 'New role from a confirmation',
      subject: 'Mercer Lane · Senior Financial Analyst',
      tone: 'info',
      roleId: 'r3',
    }),
    entry({
      id: 'e4',
      at: '2026-10-02T02:00:00Z',
      source: 'sweep',
      label: 'Closed as gone quiet',
      subject: 'Brightwater Partners · Strategy Associate',
      detail: 'No reply in 45 days.',
      roleId: 'r4',
    }),
    entry({
      id: 'e5',
      at: '2026-10-01T17:20:00Z',
      source: 'you',
      label: 'Marked as applied',
      subject: 'Oakline Insurance · Pricing Analyst',
      roleId: 'r5',
    }),
  ],
};

export function JobsActivitySurface() {
  return (
    <ActivityView
      accounts={[
        {
          id: 'acct-1',
          emailAddress: 'alex.morgan.careers@gmail.com',
          status: 'active',
          lastSyncedAt: '2026-10-03T06:02:10Z',
          backfillCompletedAt: '2026-08-14T09:00:00Z',
        },
      ]}
      activity={activity}
      timezone={ZONE}
    />
  );
}

// ---- Analytics --------------------------------------------------------------

const SOURCES: ApplicationSource[] = [
  'portal',
  'linkedin',
  'referral',
  'recruiter_inbound',
  'job_board',
];

/**
 * Forty-two applications over four months, made by rule rather than listed so
 * every rate on the page has a denominator worth reading: about half answered
 * by a person, a handful reaching a screen, two a final round and one offer.
 */
function applications(): FunnelApplication[] {
  const out: FunnelApplication[] = [];
  const stages: RejectionStage[] = [
    'resume_review',
    'recruiter_screen',
    'pre_screen',
    'hiring_manager',
  ];
  for (let i = 0; i < 42; i++) {
    const month = 6 + (i % 4);
    const day = 1 + ((i * 7) % 27);
    const submitted = new Date(Date.UTC(2026, month - 1, day, 10));
    const replied = (i * 7) % 10 < 5;
    const reached: ApplicationStatus = !replied
      ? 'submitted'
      : i === 10
        ? 'offer'
        : i === 3 || i === 13
          ? 'final_round'
          : i % 6 === 0 || i % 9 === 1
            ? 'in_process'
            : 'acknowledged';
    const rejected = replied && reached !== 'offer' && i % 3 === 1;
    out.push({
      id: `app-${i}`,
      source: SOURCES[i % SOURCES.length],
      status: rejected ? 'rejected' : reached,
      submittedAt: submitted,
      confirmationReceivedAt: new Date(submitted.getTime() + 3_600_000),
      firstHumanResponseAt: replied
        ? new Date(submitted.getTime() + (3 + (i % 9)) * 86_400_000)
        : null,
      outcome: rejected ? 'rejected' : null,
      rejectionStage: rejected ? stages[(i >> 1) % stages.length] : null,
      highWaterStatus: reached,
    });
  }
  return out;
}

export function JobsAnalyticsSurface() {
  return <AnalyticsView applications={applications()} now={new Date('2026-10-03T12:00:00Z')} />;
}

// ---- Answers ----------------------------------------------------------------

function question(over: Partial<AnswerRow> & Pick<AnswerRow, 'id' | 'text' | 'kind'>): AnswerRow {
  return {
    canonical_answer: null,
    canonical_answer_updated_at: null,
    times_seen: 1,
    application_answers: [],
    ...over,
  };
}

const answers: AnswerRow[] = [
  question({
    id: 'q1',
    text: 'Why do you want to work here?',
    kind: 'motivation',
    times_seen: 14,
    canonical_answer:
      'I want to work where the forecast is the product. Your planning team owns the numbers the business steers by, and that is the work I have been doing for four years at a smaller scale.',
    application_answers: [
      {
        id: 'aa1',
        answer: 'I want to work where the forecast is the product.',
        status: 'approved',
        application_id: 'a1',
      },
      { id: 'aa2', answer: null, status: 'draft', application_id: 'a2' },
    ],
  }),
  question({
    id: 'q2',
    text: 'Describe a time you changed a decision with a model the business had not asked for, what it showed, and what happened after',
    kind: 'behavioral',
    times_seen: 6,
  }),
  question({
    id: 'q3',
    text: 'What are your salary expectations?',
    kind: 'logistics',
    times_seen: 11,
    canonical_answer: '$95,000 to $110,000 base, depending on the bonus.',
  }),
  question({
    id: 'q4',
    text: 'Are you authorised to work in the United States?',
    kind: 'logistics',
    times_seen: 9,
    canonical_answer: 'Yes, without sponsorship.',
  }),
  question({
    id: 'q5',
    text: 'Walk us through a three-statement model',
    kind: 'technical',
    times_seen: 3,
  }),
];

export function JobsAnswersSurface() {
  return <AnswersView rows={answers} kind={undefined} />;
}

// ---- Career goals -------------------------------------------------------------

export function JobsThoughtsSurface() {
  return (
    <ThoughtsView
      tracks={{
        suggested: [
          {
            id: 't1',
            name: 'Three-statement modelling',
            about: 'Building and linking the income statement, balance sheet and cash flow.',
            depth: 'solid',
            why: 'Both FP&A entries ask for it, and it is the question you were stuck on at Halden.',
          },
        ],
        started: [
          {
            id: 't2',
            name: 'SQL for finance teams',
            about: null,
            depth: 'familiar',
            why: 'Half the analyst postings list it.',
            subjectId: 'sub-1',
            units: 6,
            gone: false,
          },
        ],
      }}
      thoughts={[
        {
          id: 'th1',
          body: 'I want an FP&A seat at a company big enough to have a planning cycle, not another startup where finance is me and a spreadsheet. Remote or hybrid, and I would take a small pay cut for a team that teaches.\n\nStrategic finance roles keep answering and then going nowhere, so I am moving most of my applications to FP&A.',
          written: '28 Sept 2026',
          edited: '1 Oct 2026',
        },
        {
          id: 'th2',
          body: 'Looking for strategy or corporate development. Open to anything in New York.',
          written: '3 Jun 2026',
          edited: null,
        },
      ]}
    />
  );
}

// ---- Onboarding ---------------------------------------------------------------

/**
 * The first step, in the column its layout gives it. The layout's header is
 * left out: any change to a layout in app/jobs/ reaches every job search
 * surface (lib/preview/routes.ts reads a route group's layout as framing all
 * of /jobs), and its mark link is still under 44 pixels on a phone.
 */
export function JobsOnboardingWelcomeSurface() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <JobsOnboardingSteps step="welcome" configured />
    </main>
  );
}

// ---- The shared case page -------------------------------------------------------

const casePage: CasePage = {
  company: 'Northbridge Capital',
  role: 'Quantitative Researcher, Systematic Macro',
  body: 'I have spent four years building the forecasting models a finance team steers by. Below is each thing the posting asks for, with the work that shows it.',
  matches: [
    {
      requirement: 'Strong Python, including pandas and numpy at scale',
      kind: 'must_have',
      verdict: 'met',
      why: '',
      evidenceItemId: 'ev1',
    },
    {
      requirement: 'Experience turning a research idea into a production signal',
      kind: 'must_have',
      verdict: 'met',
      why: '',
      evidenceItemId: 'ev2',
    },
    {
      requirement: 'Familiarity with futures and FX markets',
      kind: 'nice_to_have',
      verdict: 'met',
      why: '',
      evidenceItemId: null,
    },
  ],
  evidence: [
    {
      id: 'ev1',
      title: 'Rebuilt the revenue forecast in Python',
      body: 'Replaced a 40-tab spreadsheet with a pandas pipeline that reads the ledger nightly and reforecasts twelve months.',
      context: 'Halden & Co, 2024',
      metrics: 'Forecast error down from 9% to 3.5%',
    },
    {
      id: 'ev2',
      title: 'Took a pricing signal from notebook to the weekly pack',
      body: 'Found that renewal price changes predicted churn two quarters out, then made it a scheduled job the commercial team reads every Monday.',
      context: null,
      metrics: null,
    },
  ],
};

export function JobsCasePageSurface() {
  return <CaseView page={casePage} />;
}

// ---- An email -----------------------------------------------------------------

function message(
  over: Partial<GmailMessageContent> & Pick<GmailMessageContent, 'id'>,
): GmailMessageContent {
  return {
    threadId: 'th-1',
    internalDate: null,
    fromAddress: null,
    replyToAddress: null,
    subject: null,
    text: '',
    html: '',
    calendar: [],
    ...over,
  };
}

export function MailSurface() {
  return (
    <MailView
      timezone={ZONE}
      conversation={{
        ok: true,
        gmailHref: 'https://mail.google.com/mail/u/0/#all/18f2c0a9b7d1e2f3',
        messages: [
          message({
            id: 'm1',
            internalDate: new Date('2026-10-01T14:12:00Z'),
            fromAddress: 'Priya Raman <priya.raman@northbridgecapital.com>',
            subject: 'Quantitative Researcher, Systematic Macro: next steps',
            text: 'Hi Alex,\n\nThanks for applying. The team would like to set up a 45-minute call with the hiring manager, Tom Ellery. Could you send two or three times that work next week?\n\nBest,\nPriya',
          }),
          message({
            id: 'm2',
            internalDate: new Date('2026-10-01T16:40:00Z'),
            fromAddress: 'Alex Morgan <alex.morgan.careers@gmail.com>',
            subject: 'Re: Quantitative Researcher, Systematic Macro: next steps',
            text: 'Hi Priya,\n\nThank you. Tuesday or Wednesday afternoon, or any time Thursday, all work for me. My notes on the role are at https://example.com/notes if Tom would like them first.\n\nAlex',
          }),
        ],
      }}
    />
  );
}
