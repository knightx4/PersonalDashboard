import { SectionLabel } from '@/components/ui/section-heading';
import { Inbox, FileText, Shield } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { cardVariants } from '@/components/ui/card';
import { CasePageView, type CasePage } from '@/components/jobs/case-page';
import { ActivityPage } from '@/app/jobs/(app)/_home/today-page';
import { AnswerBank, KindChips } from '@/app/jobs/(app)/material/bank';
import OnboardingLayout from '@/app/jobs/(onboarding)/layout';
import { WelcomeForm } from '@/app/jobs/(onboarding)/onboarding/forms';
import type { Activity, ActivityEntry } from '@/lib/jobs/activity/load';

/**
 * The Jobs pages that had no picture in the gallery (plan #1601): Activity,
 * Answers, Career goals, the first onboarding step and the shared case page.
 * Analytics was retired in plan #1496.7.1.
 *
 * Activity is its own tab again (note eb898bfd), drawn from its page's view.
 * Answers and Career goals are server pages that only read and pass
 * rows to client components, so they are drawn here from those components and
 * the page's own header. Onboarding and the case page write their
 * markup in the server page itself, and that markup is repeated below with the
 * page's own helpers fed fixtures, so the pages on main stay untouched while
 * other steps change them. A later step that changes one of those two
 * should move its markup into a view both the page and this file import.
 */

// ---- Activity ---------------------------------------------------------------

function entry(
  id: string,
  at: string,
  source: ActivityEntry['source'],
  tone: ActivityEntry['tone'],
  stage: ActivityEntry['stage'],
  label: string,
  subject: string | null,
  detail: string | null = null,
): ActivityEntry {
  return { id, at, source, tone, stage, label, subject, detail, roleId: subject ? `r-${id}` : null };
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
    entry('a1', '2026-10-06T11:03:00Z', 'email', 'good', 'in_process', 'Interview booked', 'Copperline · Senior Financial Analyst, Revenue Operations and Planning', 'Hiring manager, Thursday 9 October at 2:00 pm'),
    entry('a2', '2026-10-06T11:03:00Z', 'email', 'info', 'acknowledged', 'Application confirmed', 'Wrenfield · Strategic Finance Associate'),
    entry('a3', '2026-10-06T07:00:00Z', 'sweep', 'muted', 'ghosted', 'Closed as ghosted', 'Thornbury · FP&A Manager', 'No reply in 45 days'),
    entry('a4', '2026-10-05T18:20:00Z', 'email', 'bad', 'rejected', 'Rejected after the recruiter screen', 'Saltmarsh Labs · Finance Business Partner'),
    entry('a5', '2026-10-05T09:15:00Z', 'you', 'muted', 'lead', 'Added the role', 'Ollerton Pay · Strategic Finance Lead'),
    entry('a6', '2026-10-04T16:40:00Z', 'auto', 'info', 'submitted', 'Marked as sent', 'Kittiwake · FP&A Analyst', 'A confirmation arrived for a role still in drafting'),
    entry('a7', '2026-10-03T07:00:00Z', 'sweep', 'info', 'submitted', 'Follow-up sent', 'Fenwright · Finance Operations', null),
  ],
};

/** Jobs' Activity tab, its own page again (note eb898bfd). */
export function JobsActivitySurface() {
  return (
    <ActivityPage
      timezone="America/New_York"
      activity={ACTIVITY}
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
        description={`2 of ${QUESTIONS.length} questions have a default answer`}
      />
      <div className="space-y-3">
        <KindChips
          items={[
            { label: 'All', href: '/jobs/answers', count: QUESTIONS.length, active: true },
            ...['motivation', 'behavioral', 'technical', 'logistics'].map((kind) => ({
              label: kind,
              href: `/jobs/answers?kind=${kind}`,
              count: counts.get(kind) ?? 0,
              active: false,
            })),
          ]}
        />
        <AnswerBank questions={QUESTIONS} />
      </div>
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
            <SectionLabel>Welcome</SectionLabel>
            <h1 className="font-display mt-2 text-title font-semibold tracking-tight text-ink">
              A pipeline that keeps itself current
            </h1>
          </div>

          <div className={cardVariants({ padding: 'standard' }) + ' space-y-4'}>
            <p className="text-body leading-relaxed text-ink-muted">
              Applying creates the record whether or not you remembered to log it. What that buys
              you is a funnel you can actually trust — which is the only way to see where your
              search is losing, and whether that differs by channel.
            </p>
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
          </div>
          <WelcomeForm />
        </section>
      </div>
    </OnboardingLayout>
  );
}

// ---- The shared case page ---------------------------------------------------

const CASE: CasePage = {
  company: 'Copperline',
  role: 'Senior Financial Analyst, Revenue Operations and Planning',
  body: 'I have spent four years building the planning models finance teams run the year on, most recently for a 400-person payments company. The role asks for someone who can own the revenue model and sit with the operators who move it. Below is each thing the posting asks for and the work I would point to for it. The full model behind the second example is at https://example.com/cohort-model.',
  matches: [
    { requirement: 'Own the revenue forecast and the monthly reforecast process', kind: 'must_have', verdict: 'match', why: '', evidenceItemId: 'e1' },
    { requirement: 'Build cohort and unit economics analyses that change how budget is spent', kind: 'must_have', verdict: 'match', why: '', evidenceItemId: 'e2' },
    { requirement: 'Advanced SQL', kind: 'must_have', verdict: 'match', why: '', evidenceItemId: null },
    { requirement: 'Experience at a fintech or payments company', kind: 'nice_to_have', verdict: 'match', why: '', evidenceItemId: 'e3' },
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

/** The public case page, drawn by the component the route renders. */
export function JobsCasePageSurface() {
  return <CasePageView page={CASE} />;
}
