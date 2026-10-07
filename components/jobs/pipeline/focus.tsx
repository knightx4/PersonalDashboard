import Link from 'next/link';
import { AlertTriangle, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { MoveLabel } from '@/components/ui/move-label';
import { CompanyAvatar } from '@/components/jobs/ui/company-avatar';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { applicationMove } from '@/lib/jobs/move';
import { rowRef, withRun } from '@/lib/core/move';
import { formatInterviewWhen, shortAge, type PipelineRow } from '@/lib/jobs/applications/load';
import { statusLabel } from '@/lib/jobs/status-label';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';

/**
 * The pipeline as the page you open to see where things stand.
 *
 * The board gives every stage the same column, which suits dragging and
 * nothing else: three interviews in progress got the same width as sixteen
 * leads. This reads top to bottom in the order the person cares about. What
 * is in process comes first, with whose move it is and the next interview.
 * Then what is sent and waiting, with the ones gone quiet split off. Then
 * what is not sent yet. The closed ones are one line at the end, leading to
 * the table where they are kept (plan #1590).
 *
 * Each pursuit is one line, the shape the dense-list experiment
 * (dense-list.tsx) argued for. A section with nothing in it is not drawn.
 */

/** How long a sent application can go quiet before it is listed as quiet. */
export const QUIET_DAYS = 14;

const IN_PROCESS: readonly ApplicationStatus[] = ['offer', 'final_round', 'in_process'];
const WAITING: readonly ApplicationStatus[] = ['submitted', 'acknowledged'];
const TO_APPLY: readonly ApplicationStatus[] = ['drafting', 'lead'];

function time(iso: string | null | undefined): number {
  const value = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(value) ? value : 0;
}

/** Newest activity first. */
const byRecent = (a: PipelineRow, b: PipelineRow) => time(b.lastActivityAt) - time(a.lastActivityAt);

/** Offer, then final round, then the soonest interview, then the most recent. */
function byProcess(a: PipelineRow, b: PipelineRow): number {
  const rank = IN_PROCESS.indexOf(a.status) - IN_PROCESS.indexOf(b.status);
  if (rank !== 0) return rank;
  const aNext = time(a.nextInterview?.at);
  const bNext = time(b.nextInterview?.at);
  if (aNext && bNext) return aNext - bNext;
  if (aNext || bNext) return aNext ? -1 : 1;
  return byRecent(a, b);
}

/** Drafts before leads, then the ones you are keenest on. */
function byToApply(a: PipelineRow, b: PipelineRow): number {
  const rank = TO_APPLY.indexOf(a.status) - TO_APPLY.indexOf(b.status);
  if (rank !== 0) return rank;
  const keen = (b.excitement ?? 0) - (a.excitement ?? 0);
  return keen !== 0 ? keen : byRecent(a, b);
}

export function PipelineFocus({
  rows,
  closed = [],
  closedHref,
  working = [],
  timezone = 'UTC',
}: {
  /** The live applications the filters let through. */
  rows: readonly PipelineRow[];
  /** The closed ones, counted on the last line by how each ended. */
  closed?: readonly PipelineRow[];
  /** The table, filtered to the closed applications. */
  closedHref?: string;
  working?: readonly string[];
  timezone?: string;
}) {
  const inProcess = rows.filter((row) => IN_PROCESS.includes(row.status)).sort(byProcess);
  const waiting = rows.filter((row) => WAITING.includes(row.status)).sort(byRecent);
  const recent = waiting.filter((row) => (row.daysSinceActivity ?? 0) <= QUIET_DAYS);
  const quiet = waiting.filter((row) => (row.daysSinceActivity ?? 0) > QUIET_DAYS);
  const toApply = rows.filter((row) => TO_APPLY.includes(row.status)).sort(byToApply);

  return (
    <div className="space-y-6">
      {rows.length === 0 && (
        <p className="px-2 text-ui text-ink-muted">No live applications match these filters.</p>
      )}
      {inProcess.length > 0 && (
        <FocusSection label="In process" count={inProcess.length}>
          {inProcess.map((row) => (
            <FocusLine
              key={row.applicationId}
              row={row}
              status
              move={moveFor(row, working)}
              detail={
                row.nextInterview
                  ? `Interview ${formatInterviewWhen(row.nextInterview.at, row.nextInterview.timeKnown, timezone)}`
                  : null
              }
              highlight={Boolean(row.nextInterview)}
            />
          ))}
        </FocusSection>
      )}

      {waiting.length > 0 && (
        <FocusSection label="Waiting on a reply" count={waiting.length}>
          {recent.map((row) => (
            <FocusLine key={row.applicationId} row={row} detail={sentLine(row)} />
          ))}
          {quiet.length > 0 && (
            <li className="px-2 pt-3 pb-1 text-small text-ink-muted">
              Quiet for over two weeks · {quiet.length}
            </li>
          )}
          {quiet.map((row) => (
            <FocusLine key={row.applicationId} row={row} detail={sentLine(row)} />
          ))}
        </FocusSection>
      )}

      {toApply.length > 0 && (
        <FocusSection label="To apply" count={toApply.length}>
          {toApply.map((row) => (
            <FocusLine
              key={row.applicationId}
              row={row}
              detail={row.status === 'drafting' ? 'Drafting' : null}
            />
          ))}
        </FocusSection>
      )}

      {closedHref && <ClosedLine rows={closed} href={closedHref} />}
    </div>
  );
}

function moveFor(row: PipelineRow, working: readonly string[]) {
  return withRun(
    applicationMove({
      status: row.status,
      lastEvent: row.lastTurnEvent,
      companyName: row.companyName,
    }),
    working,
    [rowRef('job_search.applications', row.applicationId), rowRef('job_search.roles', row.roleId)],
  );
}

function sentLine(row: PipelineRow): string | null {
  if (!row.submittedAt) return null;
  const age = shortAge(row.submittedAt);
  return age === 'today' ? 'Sent today' : `Sent ${age} ago`;
}

function FocusSection({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={label}>
      <h2 className="mb-1 flex items-baseline gap-2 px-2 text-ui font-semibold text-ink">
        {label}
        <span className="tabular text-small font-normal text-ink-muted">{count}</span>
      </h2>
      <ul className="divide-y divide-border">{children}</ul>
    </section>
  );
}

/**
 * One pursuit, one line: the role and company, what is next for it, and how
 * long since anything happened. The detail column drops below `sm`, where the
 * title needs the width more.
 */
function FocusLine({
  row,
  detail = null,
  status = false,
  move = null,
  highlight = false,
}: {
  row: PipelineRow;
  detail?: string | null;
  /** Show the stage badge, for sections that hold more than one stage. */
  status?: boolean;
  move?: ReturnType<typeof moveFor>;
  highlight?: boolean;
}) {
  const stale = (row.daysSinceActivity ?? 0) > QUIET_DAYS;

  return (
    <li>
      <Link
        href={`/jobs/roles/${row.roleId}`}
        // ui-ok: fixed-control-height -- a row, not a control: 44px on a
        // phone for a thumb, 40 above it so a screen holds what is open.
        className="flex min-h-11 items-center sm:min-h-10 gap-2.5 rounded-control px-2 py-1.5 transition-colors duration-quick hover:bg-shell-hover"
      >
        <CompanyAvatar
          company={{
            name: row.companyName,
            logoUrl: row.companyLogoUrl,
            domains: row.companyDomains,
            website: row.companyWebsite,
          }}
          className="size-5 shrink-0 text-micro"
        />

        <span className="min-w-0 flex-1 truncate text-ui text-ink">
          {row.roleTitle}
          <span className="ml-2 text-ink-muted">
            {row.companyName}
            {row.attempt > 1 && ` · attempt ${row.attempt}`}
          </span>
        </span>

        {row.needsReview && (
          <AlertTriangle
            className="size-3.5 shrink-0 text-caution"
            strokeWidth={2}
            aria-label="Needs review"
          />
        )}

        {detail && (
          <span
            className={cn(
              'hidden shrink-0 text-small sm:inline',
              highlight ? 'font-medium text-accent' : 'text-ink-muted',
            )}
          >
            {detail}
          </span>
        )}

        {status && (
          <StatusBadge
            status={row.status}
            everSubmitted={row.submittedAt !== null}
            className="hidden sm:inline-flex"
          />
        )}

        {move && <MoveLabel move={move.move} title={move.title} className="shrink-0" />}

        <span
          className={cn('tabular w-10 shrink-0 text-right text-micro', stale ? 'text-caution' : 'text-ink-muted')}
          title="Time since the last thing that happened"
        >
          {shortAge(row.lastActivityAt)}
        </span>
      </Link>
    </li>
  );
}

/**
 * How the closed applications ended, on one line that opens them in the
 * table. They are kept there a page at a time (plan #1590); here they only
 * need to be counted.
 */
function ClosedLine({ rows, href }: { rows: readonly PipelineRow[]; href: string }) {
  if (rows.length === 0) return null;

  const counts = new Map<string, number>();
  for (const row of rows) {
    const label = statusLabel(row.status, row.submittedAt !== null).toLowerCase();
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const ended = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => `${count} ${label}`)
    .join(' · ');

  return (
    <Link
      href={href}
      className="group flex min-h-11 items-center gap-2 rounded-control px-2 text-ui transition-colors duration-quick hover:bg-shell-hover sm:min-h-10"
    >
      <span className="font-semibold text-ink">Closed</span>
      <span className="tabular text-small text-ink-muted">{rows.length}</span>
      <span className="min-w-0 flex-1 truncate text-small text-ink-muted">{ended}</span>
      <ChevronRight
        className="size-4 shrink-0 text-ink-muted group-hover:text-ink"
        strokeWidth={1.75}
        aria-hidden
      />
    </Link>
  );
}
