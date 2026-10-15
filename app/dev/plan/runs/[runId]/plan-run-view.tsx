import Link, { linkVariants } from '@/components/ui/link';
import { ListChecks } from 'lucide-react';
import { PageHeader, type Subject } from '@/components/shell/page-header';
import { DetailFacts, DetailPage, ListRow } from '@/components/patterns/list-detail';
import { Property } from '@/components/shell/detail-layout';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LinkedText } from '@/components/ui/linked-text';
import { SectionHeading } from '@/components/ui/section-heading';
import { PLAN_STATUS_LABEL, type PlanStatus } from '@/lib/plan/load';
import type { RunJob } from '@/lib/plan/run-end';
import {
  TOUCH_REASON_LABEL,
  planRunTitle,
  sameCommit,
  type RunTouched,
  type TouchedRow,
} from '@/lib/plan/run-touched';
import type { RunLinesState } from '@/components/runs/run-lines';

/**
 * One plan run's page (plan #1964.2.4), as /goals/runs/[runId] draws a goal
 * run: the header naming the press and the step it was sent at, its facts,
 * why it stopped when it did, the lines it wrote, and every row it touched
 * as a link, then its commits. Drawn here from values the page has already
 * read, so the gallery draws the same markup from fixtures
 * (app/preview/plan-run-surfaces.tsx).
 */

/** How the run stands, from its status, as its lines and its facts read it. */
export function planRunState(status: string): RunLinesState {
  if (status === 'stale') return 'stale';
  if (status === 'awaiting_input') return 'waiting';
  if (status === 'started') return 'live';
  return 'ended';
}

/** The status fact. */
export function planRunStatusLabel(status: string): string {
  if (status === 'started') return 'Going';
  if (status === 'awaiting_input') return 'Waiting on you';
  if (status === 'stale') return 'Gone quiet';
  if (status === 'finished') return 'Finished';
  return 'Stopped';
}

function rowTitle(row: TouchedRow): string {
  if (row.kind === 'page') return row.title;
  return `#${row.step.outline ?? row.step.number} ${row.step.title}`;
}

function rowMeta(row: TouchedRow): string {
  const reason = TOUCH_REASON_LABEL[row.reason];
  if (row.kind === 'page') return `${reason} · ${row.href}`;
  const status = PLAN_STATUS_LABEL[row.step.status as PlanStatus] ?? row.step.status;
  return `${reason} · ${status}`;
}

export function PlanRunView({
  subject,
  job,
  step,
  facts,
  push,
  problem,
  lines,
  touched,
  going,
}: {
  subject?: Subject;
  job: RunJob;
  /** The step it was sent at, or null for a run sent at none (a notes run). */
  step: { href: string; label: string; title: string } | null;
  facts: { status: string; started: string; ended: string };
  /** The commit GitHub last saw it push, and when, as the commits list marks it. */
  push: { sha: string; at: string } | null;
  /** Why it stopped, or the error a failed run recorded. */
  problem: string | null;
  /** The run's lines: LiveRunLines on the page, RunLinesView in the gallery. */
  lines: React.ReactNode;
  touched: RunTouched;
  /** Whether it is still going, which the empty list says. */
  going: boolean;
}) {
  return (
    <DetailPage
      header={
        <PageHeader
          subject={subject}
          title={planRunTitle(job)}
        />
      }
      details={
        <DetailFacts>
          <Property
            label="Sent at"
            hint={step?.title}
            value={
              step ? (
                <Link href={step.href} className={`press-area ${linkVariants({ tone: 'quiet' })}`}>
                  {step.label}
                </Link>
              ) : (
                'No step'
              )
            }
          />
          <Property label="Status" value={facts.status} />
          <Property label="Started" value={facts.started} />
          <Property label="Ended" value={facts.ended} />
        </DetailFacts>
      }
      text={
        problem ? (
          <p className="text-small break-words whitespace-pre-wrap text-danger">
            <LinkedText text={problem} refs="all" />
          </p>
        ) : undefined
      }
    >
      {lines}
      <section aria-labelledby="run-touched" className="space-y-2">
        <SectionHeading id="run-touched" title="What it touched" count={touched.rows.length} />
        {touched.rows.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            size="box"
            title={going ? 'Nothing yet' : 'Nothing touched'}
            description={
              going
                ? 'Rows show here as the run names, closes or links them.'
                : 'This run named, closed and linked no rows.'
            }
          />
        ) : (
          <Card padding="none">
            <ul className="divide-y divide-border">
              {touched.rows.map((row) => (
                <ListRow key={row.key} href={row.href} title={rowTitle(row)} meta={rowMeta(row)} />
              ))}
            </ul>
          </Card>
        )}
      </section>
      {touched.commits.length > 0 && (
        <section aria-labelledby="run-commits" className="space-y-2">
          <SectionHeading id="run-commits" title="Its commits" count={touched.commits.length} />
          <Card padding="none">
            <ul className="divide-y divide-border">
              {touched.commits.map((commit) => (
                <li key={commit.sha} className="card-pad-x row-pad flex min-h-11 items-baseline gap-3">
                  <code className="tabular shrink-0 text-small text-ink-muted">{commit.sha.slice(0, 7)}</code>
                  <span className="min-w-0 flex-1">
                    <span className="block text-ui break-words text-ink">
                      {commit.subject ? <LinkedText text={commit.subject} refs="all" /> : 'No subject recorded'}
                    </span>
                    {push && sameCommit(push.sha, commit.sha) && (
                      <span className="block text-small text-ink-muted">{`Last push, ${push.at}`}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </DetailPage>
  );
}
