import { Inbox, FileText, Shield } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { CardSection } from '@/components/ui/card';
import { Figure } from '@/components/ui/figure';
import { Meter } from '@/components/ui/meter';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { LinkedText } from '@/components/ui/linked-text';
import { ActivityFeed } from '@/components/jobs/activity/activity-feed';
import { CheckInboxNow } from '@/components/jobs/activity/check-inbox-now';
import { AnswerBank } from '@/app/jobs/(app)/answers/bank';
import { ThoughtList } from '@/app/jobs/(app)/thoughts/thoughts';
import { LearningTracks } from '@/app/jobs/(app)/thoughts/tracks';
import OnboardingLayout from '@/app/jobs/(onboarding)/layout';
import { WelcomeForm } from '@/app/jobs/(onboarding)/onboarding/forms';
import type { Activity, ActivityEntry } from '@/lib/jobs/activity/load';
import {
  RESPONSE_WINDOW_DAYS,
  SOURCE_LABELS,
  advanceRate,
  countReaching,
  formatDays,
  formatRate,
  funnelMetrics,
  metricsBySource,
  monthlyCohorts,
  rejectionStageDistribution,
  type ApplicationSource,
  type ApplicationStatus,
  type FunnelApplication,
  type RejectionStage,
} from '@/lib/jobs/pipeline';

/**
 * The Jobs pages that had no picture in the gallery (plan #1601): Activity,
 * Analytics, Answers, Career goals, the first onboarding step and the shared
 * case page.
 *
 * Activity, Answers and Career goals are server pages that only read and pass
 * rows to client components, so they are drawn here from those components and
 * the page's own header. Analytics, onboarding and the case page write their
 * markup in the server page itself, and that markup is repeated below with the
 * page's own helpers fed fixtures, so the pages on main stay untouched while
 * other steps change them. A later step that changes one of those three
 * should move its markup into a view both the page and this file import.
 */

/** The instant every fixture is measured from, so the shots do not move. */
const NOW = new Date('2026-10-06T14:00:00Z');

const page = (children: React.ReactNode) => <div className="mx-auto max-w-3xl">{children}</div>;

// ---- Activity ---------------------------------------------------------------

function entry(
  id: string,
  at: string,
  source: ActivityEntry['source'],
  tone: ActivityEntry['tone'],
  label: string,
  subject: string | null,
  detail: string | null = null,
): ActivityEntry {
  return { id, at, source, tone, label, subject, detail, roleId: subject ? `r-${id}` : null };
}

const ACTIVITY: Activity = {
  runs: [
    {
      id: 'run1',
      type: 'incremental',
      status: 'succeeded',
      messagesSeen: 37,
      startedAt: '2026-10-06T11:02:00Z',
      finishedAt: '2026-10-06T11:03:41Z',
      error: null,
    },
  ],
  highlights: { days: 7, newRoles: 4, movedForward: 3, rejections: 2, closedOut: 5 },
  lastSweepAt: '2026-10-06T07:00:00Z',
  entries: [
    entry('a1', '2026-10-06T11:03:00Z', 'email', 'good', 'Interview booked', 'Ramp · Senior Financial Analyst, Revenue Operations and Planning', 'Hiring manager, Thursday 9 October at 2:00 pm'),
    entry('a2', '2026-10-06T11:03:00Z', 'email', 'info', 'Application confirmed', 'Check · Strategic Finance Associate'),
    entry('a3', '2026-10-06T07:00:00Z', 'sweep', 'muted', 'Closed as ghosted', 'Brex · FP&A Manager', 'No reply in 45 days'),
    entry('a4', '2026-10-05T18:20:00Z', 'email', 'bad', 'Rejected after the recruiter screen', 'Plaid · Finance Business Partner'),
    entry('a5', '2026-10-05T09:15:00Z', 'you', 'muted', 'Added the role', 'Mercury · Strategic Finance Lead'),
    entry('a6', '2026-10-04T16:40:00Z', 'auto', 'info', 'Marked as sent', 'Array · FP&A Analyst', 'A confirmation arrived for a role still in drafting'),
    entry('a7', '2026-10-03T07:00:00Z', 'sweep', 'info', 'Follow-up due', 'Linear · Finance Operations', null),
  ],
};

export function JobsActivitySurface() {
  return page(
    <>
      <PageHeader
        title="Activity"
        description="What the syncs have actually changed. The inbox reads mail and opens or moves roles; the nightly sweep closes what has gone quiet and raises the nudges on This week."
      />
      <CheckInboxNow
        accounts={[
          {
            id: 'acc1',
            emailAddress: 'christopher.kloughton@example.com',
            status: 'active',
            lastSyncedAt: '2026-10-06T11:03:41Z',
            backfillCompletedAt: '2026-08-14T10:00:00Z',
          },
        ]}
      />
      <ActivityFeed activity={ACTIVITY} timezone="America/New_York" />
    </>,
  );
}

// ---- Analytics --------------------------------------------------------------

function app(
  id: string,
  source: ApplicationSource,
  submitted: string,
  reached: ApplicationStatus,
  ending: { outcome: FunnelApplication['outcome']; stage: RejectionStage | null; status: ApplicationStatus } | null,
  replied: string | null,
): FunnelApplication {
  return {
    id,
    source,
    status: ending?.status ?? reached,
    submittedAt: new Date(submitted),
    confirmationReceivedAt: new Date(submitted),
    firstHumanResponseAt: replied ? new Date(replied) : null,
    outcome: ending?.outcome ?? null,
    rejectionStage: ending?.stage ?? null,
    highWaterStatus: reached,
  };
}

const rejected = (stage: RejectionStage) => ({ outcome: 'rejected' as const, stage, status: 'rejected' as const });
const ghosted = { outcome: 'ghosted' as const, stage: null, status: 'ghosted' as const };

const APPLICATIONS: FunnelApplication[] = [
  app('f1', 'portal', '2026-07-02T15:00:00Z', 'acknowledged', rejected('resume_review'), '2026-07-12T15:00:00Z'),
  app('f2', 'portal', '2026-07-05T15:00:00Z', 'acknowledged', ghosted, null),
  app('f3', 'portal', '2026-07-09T15:00:00Z', 'acknowledged', ghosted, null),
  app('f4', 'linkedin', '2026-07-14T15:00:00Z', 'in_process', rejected('recruiter_screen'), '2026-07-20T15:00:00Z'),
  app('f5', 'referral', '2026-07-21T15:00:00Z', 'final_round', rejected('final'), '2026-07-23T15:00:00Z'),
  app('f6', 'portal', '2026-08-01T15:00:00Z', 'acknowledged', rejected('resume_review'), '2026-08-15T15:00:00Z'),
  app('f7', 'portal', '2026-08-04T15:00:00Z', 'acknowledged', ghosted, null),
  app('f8', 'recruiter_inbound', '2026-08-08T15:00:00Z', 'in_process', rejected('hiring_manager'), '2026-08-08T15:00:00Z'),
  app('f9', 'linkedin', '2026-08-12T15:00:00Z', 'acknowledged', ghosted, null),
  app('f10', 'job_board', '2026-08-19T15:00:00Z', 'acknowledged', rejected('pre_screen'), '2026-08-27T15:00:00Z'),
  app('f11', 'referral', '2026-08-26T15:00:00Z', 'in_process', null, '2026-08-29T15:00:00Z'),
  app('f12', 'portal', '2026-09-02T15:00:00Z', 'acknowledged', null, null),
  app('f13', 'direct_outreach', '2026-09-08T15:00:00Z', 'in_process', null, '2026-09-10T15:00:00Z'),
  app('f14', 'portal', '2026-09-15T15:00:00Z', 'acknowledged', rejected('resume_review'), '2026-09-22T15:00:00Z'),
  app('f15', 'linkedin', '2026-09-22T15:00:00Z', 'acknowledged', null, null),
  app('f16', 'portal', '2026-09-29T15:00:00Z', 'acknowledged', null, null),
  app('f17', 'referral', '2026-10-01T15:00:00Z', 'final_round', null, '2026-10-02T15:00:00Z'),
  app('f18', 'portal', '2026-10-03T15:00:00Z', 'submitted', null, null),
];

const LADDER: Array<{ stage: ApplicationStatus; label: string }> = [
  { stage: 'submitted', label: 'Sent' },
  { stage: 'acknowledged', label: 'Acknowledged' },
  { stage: 'in_process', label: 'Screener interview' },
  { stage: 'final_round', label: 'Final round' },
  { stage: 'offer', label: 'Offer' },
];

const STAGE_LABELS: Record<string, string> = {
  pre_screen: 'Before any screen',
  resume_review: 'Resume review',
  recruiter_screen: 'Recruiter screen',
  hiring_manager: 'Hiring manager',
  technical: 'Technical',
  onsite: 'Onsite',
  final: 'Final round',
  offer_stage: 'At offer',
  unknown: 'Unknown',
};

/** The markup of app/jobs/(app)/analytics/page.tsx, from the line after its reads. */
export function JobsAnalyticsSurface() {
  const applications = APPLICATIONS;
  const overall = funnelMetrics(applications, { now: NOW });
  const bySource = metricsBySource(applications, { now: NOW });
  const cohorts = monthlyCohorts(applications, { now: NOW });
  const rejections = rejectionStageDistribution(applications);
  const reached = (stage: ApplicationStatus) => countReaching(applications, stage);

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Where in the funnel you are losing, and whether that differs by channel."
      />
      <Figure
        className="mb-8"
        label="Human response rate"
        meta={`${overall.applicationsSent} sent`}
        value={formatRate(overall.responseRate)}
        caption="Automated confirmations and bulk rejections are excluded."
        secondary={[
          { value: String(overall.applicationsSent), label: 'applications sent' },
          {
            value: formatRate(overall.confirmationRate),
            label: 'confirmed as received — not progress, only proof it landed',
          },
          { value: formatDays(overall.medianDaysToResponse), label: 'median days to a reply' },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <CardSection
          title="The funnel"
          hint="Each bar is everything that ever reached that rung — a rejection after an onsite still counts as having reached the onsite."
        >
          <ul className="mt-3 space-y-2">
            {LADDER.map((rung, index) => {
              const count = reached(rung.stage);
              const share = overall.applicationsSent === 0 ? 0 : count / overall.applicationsSent;
              const advance = index === 0 ? null : advanceRate(applications, LADDER[index - 1].stage);
              return (
                <li key={rung.stage}>
                  <div className="flex items-baseline justify-between gap-2 text-ui">
                    <span className="text-ink">{rung.label}</span>
                    <span className="tabular text-ink-muted">
                      {count}
                      <span className="ml-2 text-ink-muted">{formatRate(share)}</span>
                    </span>
                  </div>
                  <Meter
                    value={count}
                    max={overall.applicationsSent}
                    height="md"
                    minFraction={0.02}
                    className="mt-1"
                    label={`${rung.label}: ${count} of ${overall.applicationsSent} applications`}
                  />
                  {advance !== null && (
                    <p className="tabular mt-0.5 text-small text-ink-muted">
                      {formatRate(advance)} advanced from {LADDER[index - 1].label.toLowerCase()}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </CardSection>

        <CardSection
          title="By channel"
          hint="The comparison a single blended number hides. This is usually the most actionable table in the app."
        >
          <div className="mt-3">
            <Table flush>
              <THead>
                <TR>
                  <TH>Source</TH>
                  <TH num>Sent</TH>
                  <TH num>Replied</TH>
                  <TH num>Screened</TH>
                  <TH num>Ghosted</TH>
                </TR>
              </THead>
              <TBody>
                {bySource.map(({ source, metrics }) => (
                  <TR key={source}>
                    <TD primary>{SOURCE_LABELS[source]}</TD>
                    <TD label="Sent" num muted>
                      {metrics.applicationsSent}
                    </TD>
                    <TD label="Replied" num>
                      {formatRate(metrics.responseRate)}
                    </TD>
                    <TD label="Screened" num muted>
                      {formatRate(metrics.screenRate)}
                    </TD>
                    <TD label="Ghosted" num muted>
                      {formatRate(metrics.ghostRate)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </CardSection>

        <CardSection
          title="By month applied"
          hint="Cohorted by submission date, always. Applications sent in June stay the June cohort forever and their response rate fills in as replies arrive."
        >
          <div className="mt-3">
            <Table flush>
              <THead>
                <TR>
                  <TH>Month</TH>
                  <TH num>Sent</TH>
                  <TH num>Replied</TH>
                  <TH num>Screened</TH>
                </TR>
              </THead>
              <TBody>
                {cohorts.map(({ period, metrics }) => (
                  <TR key={period.label}>
                    <TD primary className="tabular">
                      {period.label}
                    </TD>
                    <TD label="Sent" num muted>
                      {metrics.applicationsSent}
                    </TD>
                    <TD label="Replied" num muted={metrics.tooEarly}>
                      {metrics.tooEarly ? 'too early' : formatRate(metrics.responseRate)}
                    </TD>
                    <TD label="Screened" num muted>
                      {metrics.tooEarly ? '—' : formatRate(metrics.screenRate)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <p className="mt-2 text-small leading-relaxed text-ink-muted">
            A month is marked &ldquo;too early&rdquo; until its newest applications are{' '}
            {RESPONSE_WINDOW_DAYS} days old. Including them would drag every rate toward zero and
            make recent effort look like failure.
          </p>
        </CardSection>

        <CardSection
          title="Where rejections happen"
          hint="Rejection at resume review and rejection after a final round are opposite diagnoses leading to opposite responses. Without this split, every rejection looks the same."
        >
          {rejections.length === 0 ? (
            <p className="mt-3 text-ui text-ink-muted">No rejections recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {rejections.map((item) => {
                const total = rejections.reduce((sum, e) => sum + e.count, 0);
                return (
                  <li key={item.stage}>
                    <div className="flex items-baseline justify-between gap-2 text-ui">
                      <span className="text-ink">{STAGE_LABELS[item.stage] ?? item.stage}</span>
                      <span className="tabular text-ink-muted">{item.count}</span>
                    </div>
                    <Meter
                      value={item.count}
                      max={total}
                      fill="bg-status-rejected"
                      height="md"
                      minFraction={0.02}
                      className="mt-1"
                      label={`${STAGE_LABELS[item.stage] ?? item.stage}: ${item.count} of ${total} rejections`}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardSection>
      </div>
    </>
  );
}

// ---- Answers ----------------------------------------------------------------

const QUESTIONS = [
  {
    id: 'q1',
    text: 'Why do you want to work at this company?',
    kind: 'motivation',
    canonicalAnswer:
      'I want to work where finance is part of how the company decides, not a report it reads afterwards. Your planning team sits with the operators, and the role owns the model the leadership team runs the year on.',
    timesSeen: 14,
    usedIn: 9,
    approvedAnswer: null,
  },
  {
    id: 'q2',
    text: 'Describe a time you changed a decision with an analysis that the people around you did not expect, and what happened after the decision was made.',
    kind: 'behavioral',
    canonicalAnswer: null,
    timesSeen: 6,
    usedIn: 1,
    approvedAnswer:
      'At my last company the plan assumed paid acquisition would scale linearly. I rebuilt the cohort model by channel and showed the marginal cost doubling past the second quarter, and we moved a third of the budget to partnerships.',
  },
  {
    id: 'q3',
    text: 'Are you legally authorized to work in the United States?',
    kind: 'logistics',
    canonicalAnswer: 'Yes.',
    timesSeen: 11,
    usedIn: 11,
    approvedAnswer: null,
  },
  {
    id: 'q4',
    text: 'What are your salary expectations?',
    kind: 'logistics',
    canonicalAnswer: null,
    timesSeen: 8,
    usedIn: 0,
    approvedAnswer: null,
  },
  {
    id: 'q5',
    text: 'Walk us through how you would build a three-statement model for a subscription business.',
    kind: 'technical',
    canonicalAnswer: null,
    timesSeen: 2,
    usedIn: 0,
    approvedAnswer: null,
  },
];

export function JobsAnswersSurface() {
  const counts = new Map<string, number>();
  for (const question of QUESTIONS) counts.set(question.kind, (counts.get(question.kind) ?? 0) + 1);
  return (
    <>
      <PageHeader
        title="Answers"
        description={`2 of ${QUESTIONS.length} questions have a default answer. Each one you set makes the next application shorter.`}
      />
      <div className="flex flex-col gap-4 xl:flex-row xl:gap-6">
        <LeftRail>
          <RailGroup label="Kind">
            <RailItem label="All" href="/jobs/answers" active count={QUESTIONS.length} />
            {['motivation', 'behavioral', 'technical', 'logistics'].map((kind) => (
              <RailItem key={kind} label={kind} href={`/jobs/answers?kind=${kind}`} count={counts.get(kind) ?? 0} />
            ))}
          </RailGroup>
          <p className="px-1 text-small leading-relaxed text-ink-muted">
            Questions are deduped by fingerprint, so the same question asked in different words
            lands on one row.
          </p>
        </LeftRail>
        <div className="min-w-0 flex-1">
          <AnswerBank questions={QUESTIONS} />
        </div>
      </div>
    </>
  );
}

// ---- Career goals -----------------------------------------------------------

export function JobsThoughtsSurface() {
  return (
    <>
      <PageHeader
        title="Career goals"
        description="What you want from the next job and where you are now, in your own words. Add a new entry when your thinking changes; the newest one counts."
      />
      <div className="mb-3 max-w-3xl">
        <LearningTracks
          hasEntries
          started={[
            {
              id: 't1',
              name: 'Cohort analysis for subscription businesses',
              about: 'Retention curves, payback and LTV by acquisition channel',
              depth: 'solid',
              why: 'Every strategic finance role you described asks for it.',
              subjectId: 's1',
              units: 6,
              gone: false,
            },
          ]}
          suggested={[
            {
              id: 't2',
              name: 'SQL for finance',
              about: null,
              depth: 'familiar',
              why: 'You want to pull your own numbers rather than wait on the data team.',
            },
            {
              id: 't3',
              name: 'Board-level storytelling with a planning model, from assumptions to the one slide that carries the decision',
              about: 'Turning a model into the case the leadership team acts on',
              depth: 'deep',
              why: 'The next step up is presenting the plan, not only building it.',
            },
          ]}
        />
      </div>
      <ThoughtList
        thoughts={[
          {
            id: 'th1',
            body: 'I want a strategic finance role at a company between 200 and 1,000 people, where the planning model is the thing the leadership team argues over. Not another reporting job. I am strongest at building the model and weakest at presenting it, so a role with a CFO who lets me present would be worth a smaller title.',
            written: 'Oct 2, 2026',
            edited: 'Oct 4, 2026',
          },
          {
            id: 'th2',
            body: 'Starting the search. Open to FP&A or strategic finance, fintech or developer tools, New York or remote.',
            written: 'Jul 1, 2026',
            edited: null,
          },
        ]}
      />
    </>
  );
}

// ---- Onboarding, first step ---------------------------------------------------

/** The markup of the welcome step in app/jobs/(onboarding)/onboarding/page.tsx, in its layout. */
export function JobsOnboardingSurface() {
  const index = 0;
  return (
    <OnboardingLayout>
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-8 flex items-center gap-2" aria-hidden>
          {['welcome', 'companies', 'gmail', 'done'].map((entry, position) => (
            <div
              key={entry}
              className={
                position <= index ? 'h-1 flex-1 rounded-full bg-accent' : 'h-1 flex-1 rounded-full bg-border'
              }
            />
          ))}
        </div>
        <section className="space-y-6">
          <div>
            <p className="text-ui font-medium uppercase tracking-wider text-ink-muted">Welcome</p>
            <h1 className="font-display mt-2 text-title font-semibold tracking-tight text-ink">
              A pipeline that keeps itself current
            </h1>
            <p className="mt-3 text-body leading-relaxed text-ink-muted">
              Applying creates the record whether or not you remembered to log it. What that buys
              you is a funnel you can actually trust — which is the only way to see where your
              search is losing, and whether that differs by channel.
            </p>
          </div>
          <ul className="space-y-3 text-body text-ink">
            <li className="flex gap-3">
              <Inbox className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
              <span>Confirmations, rejections, interview invites and recruiter mail, read and filed.</span>
            </li>
            <li className="flex gap-3">
              <FileText className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
              <span>Paste a job link and the description, requirements and questions come with it.</span>
            </li>
            <li className="flex gap-3">
              <Shield className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
              <span>Email bodies are never stored. Never fills in a form or applies for you.</span>
            </li>
          </ul>
          <WelcomeForm />
        </section>
      </div>
    </OnboardingLayout>
  );
}

// ---- The shared case page ---------------------------------------------------

const CASE = {
  company: 'Ramp',
  role: 'Senior Financial Analyst, Revenue Operations and Planning',
  body: 'I have spent four years building the planning models finance teams run the year on, most recently for a 400-person payments company. The role asks for someone who can own the revenue model and sit with the operators who move it. Below is each thing the posting asks for and the work I would point to for it. The full model behind the second example is at https://example.com/cohort-model.',
  matches: [
    { requirement: 'Own the revenue forecast and the monthly reforecast process', kind: 'must_have', evidenceItemId: 'e1' },
    { requirement: 'Build cohort and unit economics analyses that change how budget is spent', kind: 'must_have', evidenceItemId: 'e2' },
    { requirement: 'Advanced SQL', kind: 'must_have', evidenceItemId: null },
    { requirement: 'Experience at a fintech or payments company', kind: 'nice_to_have', evidenceItemId: 'e3' },
  ],
  evidence: [
    {
      id: 'e1',
      title: 'Rebuilt the revenue forecast',
      body: 'Replaced a top-down growth rate with a driver model by segment, reforecast monthly with the sales and success leads.',
      context: 'Halyard Payments, 2023–2026',
      metrics: 'Forecast error from 11% to 3% over four quarters',
    },
    {
      id: 'e2',
      title: 'Moved a third of paid budget to partnerships',
      body: 'Showed marginal acquisition cost doubling past the second quarter by channel cohort.',
      context: 'Halyard Payments, 2025',
      metrics: '$1.2M a year moved',
    },
    {
      id: 'e3',
      title: 'Four years in payments finance',
      body: 'Planning and analysis for card issuing and merchant acquiring lines.',
      context: null,
      metrics: null,
    },
  ],
};

/** The markup of app/jobs/p/[slug]/page.tsx, with one shared page as its read. */
export function JobsCasePageSurface() {
  const pageData = CASE;
  const byId = new Map(pageData.evidence.map((item) => [item.id, item]));
  const groups = [
    { kind: 'must_have', label: 'What the role asks for' },
    { kind: 'nice_to_have', label: 'Also mentioned' },
  ];

  return (
    <main className="mx-auto max-w-2xl px-5 py-12">
      <header>
        <p className="text-ui text-ink-muted">{pageData.company}</p>
        <h1 className="font-display mt-0.5 text-title tracking-tight text-ink">{pageData.role}</h1>
      </header>
      <section className="mt-6 whitespace-pre-wrap text-body leading-relaxed text-ink">
        <LinkedText text={pageData.body} />
      </section>
      <section className="mt-10">
        <h2 className="text-body font-semibold text-ink">The role, line by line</h2>
        <p className="mt-0.5 text-ui text-ink-muted">Each requirement below, and the work behind it.</p>
        {groups.map((group) => {
          const lines = pageData.matches.filter((match) => match.kind === group.kind);
          if (lines.length === 0) return null;
          return (
            <div key={group.kind} className="mt-5">
              <h3 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">{group.label}</h3>
              <ul className="mt-2 space-y-4">
                {lines.map((match, index) => {
                  const item = match.evidenceItemId ? byId.get(match.evidenceItemId) : null;
                  return (
                    <li key={`${group.kind}-${index}`} className="border-l-2 border-border pl-3">
                      <p className="text-body font-medium text-ink">{match.requirement}</p>
                      {item && (
                        <div className="mt-1">
                          <p className="text-ui text-ink">
                            <span className="font-medium">{item.title}</span>
                            {item.context && <span className="text-ink-muted"> · {item.context}</span>}
                          </p>
                          <p className="mt-0.5 text-ui leading-relaxed text-ink-muted">{item.body}</p>
                          {item.metrics && <p className="tabular mt-0.5 text-ui text-ink">{item.metrics}</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>
      <footer className="mt-12 border-t border-border pt-4 text-small text-ink-muted">
        A private link, shared for this application. It expires.
      </footer>
    </main>
  );
}
