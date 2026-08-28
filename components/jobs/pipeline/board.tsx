'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { AlertTriangle, GripVertical, X } from 'lucide-react';
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
const COLUMNS: Array<{ status: ApplicationStatus; label: string; hint: string }> = [
  { status: 'lead', label: 'Leads', hint: 'Saved, not applied' },
  { status: 'drafting', label: 'Drafting', hint: 'You are working on it' },
  { status: 'submitted', label: 'Submitted', hint: 'Sent, no confirmation yet' },
  { status: 'acknowledged', label: 'Acknowledged', hint: 'It landed somewhere real' },
  { status: 'in_process', label: 'In process', hint: 'A human is involved' },
  { status: 'final_round', label: 'Final round', hint: '' },
  { status: 'offer', label: 'Offer', hint: '' },
];

/** How long a live pursuit can go quiet before the card starts saying so. */
export const STALE_DAYS = 14;

/** Closed pursuits live in one shared column so the live board stays readable. */
const CLOSED: readonly ApplicationStatus[] = ['rejected', 'withdrawn', 'ghosted', 'role_closed'];

export function PipelineBoard({ rows }: { rows: PipelineRow[] }) {
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

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg bg-status-rejected-tint px-3 py-2 text-[13px] text-status-rejected">
          {error}
        </p>
      )}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((column) => {
          const columnRows = rows.filter((row) => statusOf(row) === column.status);
          return (
            <section
              key={column.status}
              onDragOver={(event) => {
                event.preventDefault();
                setOver(column.status);
              }}
              onDragLeave={() => setOver((current) => (current === column.status ? null : current))}
              onDrop={() => drop(column.status)}
              className={cn(
                'w-64 shrink-0 rounded-card border border-border bg-canvas p-2 transition-colors duration-150',
                over === column.status && 'border-brand bg-brand-tint',
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
                  <p className="px-1.5 py-6 text-center text-[12px] text-ink-faint">
                    Nothing here
                  </p>
                )}
              </div>
            </section>
          );
        })}
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
        {!muted && <Dismiss row={row} />}
      </div>

      {row.nextAction && (
        <p className="mt-1.5 truncate rounded bg-canvas px-1.5 py-1 text-[11px] text-ink-muted">
          {row.nextAction}
          {row.nextActionDue && <span className="ml-1 text-accent-orange">· {row.nextActionDue}</span>}
        </p>
      )}

      <div className="mt-1.5 flex items-center justify-between gap-2">
        {muted ? <StatusBadge status={row.status} /> : <span />}
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
