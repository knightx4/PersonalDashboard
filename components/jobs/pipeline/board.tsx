'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { AlertTriangle, Ban, GripVertical, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import type { PipelineRow } from '@/lib/jobs/applications/load';
import { shortAge } from '@/lib/jobs/applications/load';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { dismissPursuit, moveApplication } from '@/app/jobs/(app)/pipeline/actions';

/**
 * The kanban board.
 *
 * Dragging is the most-used interaction in the app, so it gets real attention:
 * the card lifts out, the target column shows where it will land, and the write
 * is optimistic so the board never stutters. A drop writes a status_override
 * EVENT — the status column itself is derived and nothing here touches it.
 *
 * 'ghosted' has no column. It is a view over silence rather than a place you
 * put things, and giving it a column would invite people to drag cards into it.
 */
/**
 * `submitted` and `acknowledged` share a column, labeled by the later one:
 * nearly everything here is created from a confirmation email and lands
 * straight on `acknowledged`, so `submitted` -- sent, no confirmation yet --
 * almost never has a card in it on its own, and stayed empty as its own
 * column. `setStatus` is what a manual move or drag writes; the underlying
 * event log can still tell the two apart for anything that reads it directly.
 *
 * `final_round` folds into `in_process` the same way. The status itself, and
 * everything derived from it (analytics, rejection-stage inference), is
 * untouched -- only the board stops giving it its own column.
 */
const COLUMNS: Array<{ statuses: ApplicationStatus[]; setStatus: ApplicationStatus; label: string; hint: string }> = [
  { statuses: ['lead'], setStatus: 'lead', label: 'Leads', hint: 'Saved, not applied' },
  { statuses: ['drafting'], setStatus: 'drafting', label: 'Drafting', hint: 'You are working on it' },
  {
    statuses: ['submitted', 'acknowledged'],
    setStatus: 'acknowledged',
    label: 'Submitted',
    hint: 'Sent, and landed somewhere real',
  },
  {
    statuses: ['in_process', 'final_round'],
    setStatus: 'in_process',
    label: 'In process',
    hint: 'A human is involved',
  },
  { statuses: ['offer'], setStatus: 'offer', label: 'Offer', hint: '' },
];

/** How long a live pursuit can go quiet before the card starts saying so. */
export const STALE_DAYS = 14;

/** Closed pursuits live in one shared column so the live board stays readable. */
const CLOSED: readonly ApplicationStatus[] = ['rejected', 'withdrawn', 'ghosted', 'role_closed'];

export type PipelineView = 'board' | 'list';

export function PipelineBoard({
  rows,
  view = 'board',
}: {
  rows: PipelineRow[];
  view?: PipelineView;
}) {
  const [optimistic, setOptimistic] = useState<Record<string, ApplicationStatus>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ApplicationStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const statusOf = (row: PipelineRow): ApplicationStatus =>
    optimistic[row.applicationId] ?? row.status;

  function drop(status: ApplicationStatus) {
    const applicationId = dragging;
    setOver(null);
    setDragging(null);
    if (!applicationId) return;

    const row = rows.find((r) => r.applicationId === applicationId);
    if (!row || statusOf(row) === status) return;

    setOptimistic((prev) => ({ ...prev, [applicationId]: status }));
    setError(null);

    startTransition(async () => {
      const result = await moveApplication(applicationId, status);
      if (result.error) {
        setError(result.error);
        setOptimistic((prev) => {
          const next = { ...prev };
          delete next[applicationId];
          return next;
        });
      }
    });
  }

  const closedRows = rows.filter((row) => CLOSED.includes(statusOf(row)));

  // The kanban board is a horizontal scroll through one and a half columns
  // on a phone, whatever view the user picked for desktop — so a phone
  // always gets the stacked, collapsible layout, and the toggle only
  // decides what sm-and-up sees.
  const renderColumns = (mode: PipelineView) =>
    COLUMNS.map((column) => {
      const columnRows = rows.filter((row) => column.statuses.includes(statusOf(row)));

      if (mode === 'list') {
        return (
          <details
            key={column.setStatus}
            open={columnRows.length > 0}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(column.setStatus);
            }}
            onDragLeave={() =>
              setOver((current) => (current === column.setStatus ? null : current))
            }
            onDrop={() => drop(column.setStatus)}
            className={cn(
              'rounded-card border border-border bg-canvas transition-colors duration-150',
              over === column.setStatus && 'border-brand bg-brand-tint',
            )}
          >
            <summary className="flex cursor-pointer items-baseline gap-2 px-3 py-2">
              <span className="text-[13px] font-semibold text-ink">{column.label}</span>
              <span className="tabular text-[13px] text-ink-faint">{columnRows.length}</span>
              {column.hint && <span className="text-[11px] text-ink-faint">{column.hint}</span>}
            </summary>
            <div className="space-y-2 px-2 pb-2">
              {columnRows.map((row) => (
                <Card
                  key={row.applicationId}
                  row={row}
                  dragging={dragging === row.applicationId}
                  onDragStart={() => setDragging(row.applicationId)}
                  onDragEnd={() => setDragging(null)}
                />
              ))}
              {columnRows.length === 0 && (
                <p className="px-1.5 py-2 text-[12px] text-ink-faint">Nothing here</p>
              )}
            </div>
          </details>
        );
      }

      return (
        <section
          key={column.setStatus}
          onDragOver={(event) => {
            event.preventDefault();
            setOver(column.setStatus);
          }}
          onDragLeave={() => setOver((current) => (current === column.setStatus ? null : current))}
          onDrop={() => drop(column.setStatus)}
          className={cn(
            'w-64 shrink-0 rounded-card border border-border bg-canvas p-2 transition-colors duration-150',
            over === column.setStatus && 'border-brand bg-brand-tint',
          )}
          aria-label={column.label}
        >
          <header className="mb-2 flex items-baseline justify-between px-1.5 pt-1">
            <h2 className="text-[13px] font-semibold text-ink">{column.label}</h2>
            <span className="tabular text-[13px] text-ink-faint">{columnRows.length}</span>
          </header>
          {column.hint && (
            <p className="mb-2 px-1.5 text-[11px] leading-snug text-ink-faint">{column.hint}</p>
          )}

          <div className="space-y-2">
            {columnRows.map((row) => (
              <Card
                key={row.applicationId}
                row={row}
                dragging={dragging === row.applicationId}
                onDragStart={() => setDragging(row.applicationId)}
                onDragEnd={() => setDragging(null)}
              />
            ))}
            {columnRows.length === 0 && (
              <p className="px-1.5 py-6 text-center text-[12px] text-ink-faint">Nothing here</p>
            )}
          </div>
        </section>
      );
    });

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg bg-status-rejected-tint px-3 py-2 text-[13px] text-status-rejected">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2 sm:hidden">{renderColumns('list')}</div>
      <div
        className={cn(
          'hidden sm:flex',
          view === 'board' ? 'gap-3 overflow-x-auto pb-2' : 'flex-col gap-2',
        )}
      >
        {renderColumns(view)}
      </div>

      {closedRows.length > 0 && (
        <details className="rounded-card border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ink-muted">
            Closed — {closedRows.length}
          </summary>
          <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2 lg:grid-cols-4">
            {closedRows.map((row) => (
              <Card key={row.applicationId} row={row} dragging={false} muted />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Card({
  row,
  dragging,
  muted = false,
  onDragStart,
  onDragEnd,
}: {
  row: PipelineRow;
  dragging: boolean;
  muted?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const age = shortAge(row.lastActivityAt);
  const stale = (row.daysSinceActivity ?? 0) > STALE_DAYS;

  return (
    <article
      draggable={!muted}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'group rounded-lg border border-border bg-surface p-2.5',
        !muted && 'lift cursor-grab',
        dragging && 'dragging',
        muted && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-1.5">
        {!muted && (
          <GripVertical
            className="mt-0.5 size-3.5 shrink-0 text-ink-faint opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            strokeWidth={1.75}
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          <Link
            href={`/jobs/roles/${row.roleId}`}
            className="block truncate text-[13px] font-medium text-ink hover:text-brand"
          >
            {row.roleTitle}
          </Link>
          <p className="truncate text-[12px] text-ink-muted">
            {row.companyName}
            {row.attempt > 1 && (
              <span className="ml-1 text-ink-faint">· attempt {row.attempt}</span>
            )}
          </p>
        </div>
        {row.excitement !== null && (
          <span className="tabular shrink-0 text-[11px] text-ink-faint" title="Excitement">
            {'★'.repeat(row.excitement)}
          </span>
        )}
        {!muted && (
          <span className="flex shrink-0 items-center gap-0.5">
            <QuickReject row={row} />
            <Dismiss row={row} />
          </span>
        )}
      </div>

      {row.nextAction && (
        <p className="mt-1.5 truncate rounded bg-canvas px-1.5 py-1 text-[11px] text-ink-muted">
          {row.nextAction}
          {row.nextActionDue && <span className="ml-1 text-accent-orange">· {row.nextActionDue}</span>}
        </p>
      )}

      <div className="mt-1.5 flex items-center justify-between gap-2">
        {muted ? (
          <StatusBadge status={row.status} everSubmitted={row.submittedAt !== null} />
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          {row.needsReview && (
            <AlertTriangle className="size-3.5 text-accent-orange" strokeWidth={2} aria-label="Needs review" />
          )}
          <span
            className={cn('tabular text-[11px]', stale ? 'text-accent-orange' : 'text-ink-faint')}
            title="Time since the last thing that happened"
          >
            {age}
          </span>
        </div>
      </div>
    </article>
  );
}

/**
 * "Send this straight to rejected."
 *
 * A rejection you already know about — a form-letter no, a posting that
 * vanished — otherwise costs a drag across every column in between, or a trip
 * to the status picker on the role page. This writes the same status_override
 * event `moveApplication` always has; it just skips the trip.
 */
function QuickReject({ row }: { row: PipelineRow }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (row.status === 'rejected') return null;

  if (confirming) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await moveApplication(row.applicationId, 'rejected');
              setConfirming(false);
            })
          }
          className="press rounded px-1.5 py-0.5 text-[11px] font-medium text-status-rejected hover:bg-status-rejected-tint"
        >
          {pending ? 'Moving…' : 'Reject'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="press rounded px-1 py-0.5 text-[11px] text-ink-faint hover:text-ink"
        >
          Keep
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      title="Send straight to rejected"
      onClick={() => setConfirming(true)}
      className="press shrink-0 rounded p-0.5 text-ink-faint opacity-0 transition-opacity duration-150 hover:text-status-rejected focus-visible:opacity-100 group-hover:opacity-100"
    >
      <Ban className="size-3.5" strokeWidth={2} aria-hidden />
      <span className="sr-only">Send straight to rejected</span>
    </button>
  );
}

/**
 * "This was not real."
 *
 * On the card rather than only in the review queue, because a wrongly opened
 * pursuit is most obvious exactly where you are looking at the board — and
 * once it has been confirmed, or has aged out of the queue, the queue is no
 * longer somewhere you would think to go.
 *
 * Hidden until hover so the board stays calm, but always reachable from the
 * keyboard.
 */
function Dismiss({ row }: { row: PipelineRow }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              await dismissPursuit(row.applicationId);
            })
          }
          className="press rounded px-1.5 py-0.5 text-[11px] font-medium text-status-rejected hover:bg-status-rejected-tint"
        >
          {pending ? 'Removing…' : 'Remove'}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="press rounded px-1 py-0.5 text-[11px] text-ink-faint hover:text-ink"
        >
          Keep
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      title="Not a real pursuit — remove it"
      onClick={() => setConfirming(true)}
      className="press shrink-0 rounded p-0.5 text-ink-faint opacity-0 transition-opacity duration-150 hover:text-status-rejected focus-visible:opacity-100 group-hover:opacity-100"
    >
      <X className="size-3.5" strokeWidth={2} aria-hidden />
      <span className="sr-only">Not a real pursuit — remove it</span>
    </button>
  );
}
