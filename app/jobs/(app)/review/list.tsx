'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { formatDate } from '@/lib/jobs/applications/load';
import { classificationLabel, type ReviewRow } from '@/lib/jobs/review/load';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import {
  acknowledgeEvent,
  confirmApplication,
  deleteInferredApplication,
  dismissMessage,
  linkMessage,
  reopenApplication,
} from './actions';

/**
 * Keyboard-first, because the queue is worked in bursts.
 *
 *   j / k or arrows   move between rows
 *   1 2 3             link to the first, second or third candidate
 *   x                 dismiss
 *   enter             confirm (on an inferred application)
 */
export function ReviewList({
  rows,
  timezone,
  companyCount,
}: {
  rows: ReviewRow[];
  timezone: string;
  companyCount: number;
}) {
  const [cursor, setCursor] = useState(0);
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      const row = rows[cursor];
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        setCursor((current) => Math.min(current + 1, rows.length - 1));
        return;
      }
      if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor((current) => Math.max(current - 1, 0));
        return;
      }
      if (!row) return;

      if (row.kind === 'message' && ['1', '2', '3'].includes(event.key)) {
        const candidate = row.candidates[Number(event.key) - 1];
        if (!candidate) return;
        event.preventDefault();
        startTransition(async () => {
          const result = await linkMessage(row.id, candidate.applicationId);
          setMessage(result.error ?? `Linked to ${candidate.label}.`);
        });
        return;
      }

      if (event.key === 'x') {
        event.preventDefault();
        startTransition(async () => {
          const result =
            row.kind === 'message'
              ? await dismissMessage(row.id)
              : row.kind === 'event'
                ? await acknowledgeEvent(row.id)
                : await deleteInferredApplication(row.applicationId);
          setMessage(result.error ?? 'Done.');
        });
        return;
      }

      if (event.key === 'Enter' && row.kind === 'application') {
        event.preventDefault();
        startTransition(async () => {
          const result = await confirmApplication(row.applicationId);
          setMessage(result.error ?? 'Confirmed.');
        });
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cursor, rows]);

  return (
    <div ref={containerRef} className="space-y-2">
      <p className="text-[11px] text-ink-faint">
        <kbd className="rounded border border-border bg-surface px-1">j</kbd>/
        <kbd className="rounded border border-border bg-surface px-1">k</kbd> to move,{' '}
        <kbd className="rounded border border-border bg-surface px-1">1</kbd>–
        <kbd className="rounded border border-border bg-surface px-1">3</kbd> to link,{' '}
        <kbd className="rounded border border-border bg-surface px-1">x</kbd> to dismiss.
      </p>

      {message && (
        <p role="status" className="rounded-lg bg-brand-tint px-3 py-2 text-[13px] text-brand">
          {message}
        </p>
      )}

      {rows.map((row, index) => (
        <article
          key={`${row.kind}-${row.id}`}
          onClick={() => setCursor(index)}
          className={cn(
            'rounded-card border bg-surface p-4 transition-colors duration-150',
            index === cursor ? 'border-brand ring-2 ring-brand/15' : 'border-border',
          )}
        >
          {row.kind === 'message' && (
            <MessageRow row={row} timezone={timezone} busy={busy} companyCount={companyCount} onDone={setMessage} />
          )}
          {row.kind === 'application' && (
            <ApplicationRow row={row} timezone={timezone} busy={busy} onDone={setMessage} />
          )}
          {row.kind === 'event' && (
            <EventRow row={row} timezone={timezone} busy={busy} onDone={setMessage} />
          )}
        </article>
      ))}
    </div>
  );
}

function MessageRow({
  row,
  timezone,
  busy,
  companyCount,
  onDone,
}: {
  row: Extract<ReviewRow, { kind: 'message' }>;
  timezone: string;
  busy: boolean;
  companyCount: number;
  onDone: (message: string) => void;
}) {
  const [, startTransition] = useTransition();

  return (
    <>
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="rounded-full bg-canvas px-2 py-0.5 text-[11px] font-medium text-ink-muted">
          {classificationLabel(row.classification)}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {row.subject ?? '(no subject)'}
        </h3>
        <span className="tabular text-[12px] text-ink-faint">
          {formatDate(row.receivedAt, timezone)}
        </span>
      </header>

      <p className="mt-0.5 truncate text-[12px] text-ink-muted">{row.fromAddress ?? 'unknown sender'}</p>
      <p className="mt-1.5 text-[12px] text-ink-muted">{row.reason}</p>

      {row.candidates.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-faint">
          {companyCount === 0
            ? 'No companies on file yet, so there is nothing to match against. Add a role and this becomes linkable.'
            : 'No pursuits to link this to yet.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {row.candidates.map((candidate, index) => (
            <li key={candidate.applicationId} className="flex flex-wrap items-center gap-2">
              <kbd className="rounded border border-border bg-canvas px-1.5 text-[11px] text-ink-faint">
                {index + 1}
              </kbd>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] text-ink">{candidate.label}</p>
                <p className="truncate text-[11px] text-ink-faint">
                  {candidate.reason}
                  {candidate.confidence !== null &&
                    ` · ${Math.round(candidate.confidence * 100)}% match`}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  startTransition(async () => {
                    const result = await linkMessage(row.id, candidate.applicationId);
                    onDone(result.error ?? `Linked to ${candidate.label}.`);
                  })
                }
              >
                Link
              </Button>
            </li>
          ))}
        </ul>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            startTransition(async () => {
              const result = await dismissMessage(row.id);
              onDone(result.error ?? 'Dismissed, and the subject and sender were cleared.');
            })
          }
        >
          Not relevant
        </Button>
        {row.gmailHref && (
          <a
            href={row.gmailHref}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Open in Gmail
            <ExternalLink className="size-3" strokeWidth={1.75} />
          </a>
        )}
      </footer>
    </>
  );
}

function ApplicationRow({
  row,
  timezone,
  busy,
  onDone,
}: {
  row: Extract<ReviewRow, { kind: 'application' }>;
  timezone: string;
  busy: boolean;
  onDone: (message: string) => void;
}) {
  const [, startTransition] = useTransition();

  return (
    <>
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="rounded-full bg-brand-tint px-2 py-0.5 text-[11px] font-medium text-brand">
          Created from email
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {row.companyName} · {row.roleTitle}
        </h3>
        <StatusBadge status={row.status as ApplicationStatus} everSubmitted={row.submittedAt !== null} />
        <span className="tabular text-[12px] text-ink-faint">
          {formatDate(row.submittedAt, timezone)}
        </span>
      </header>

      <p className="mt-1.5 text-[12px] text-ink-muted">{row.reason}</p>

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() =>
            startTransition(async () => {
              const result = await confirmApplication(row.applicationId);
              onDone(result.error ?? 'Confirmed.');
            })
          }
        >
          Looks right
        </Button>
        <Link
          href={`/jobs/roles/${row.roleId}`}
          className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          Edit the details
        </Link>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteInferredApplication(row.applicationId);
              onDone(result.error ?? 'Removed.');
            })
          }
        >
          I never applied
        </Button>
      </footer>
    </>
  );
}

function EventRow({
  row,
  timezone,
  busy,
  onDone,
}: {
  row: Extract<ReviewRow, { kind: 'event' }>;
  timezone: string;
  busy: boolean;
  onDone: (message: string) => void;
}) {
  const [, startTransition] = useTransition();

  return (
    <>
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="rounded-full bg-accent-orange-tint px-2 py-0.5 text-[11px] font-medium text-ink">
          Arrived after it closed
        </span>
        <h3 className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
          {row.companyName} · {row.roleTitle}
        </h3>
        <StatusBadge status={row.status as ApplicationStatus} />
        <span className="tabular text-[12px] text-ink-faint">
          {formatDate(row.occurredAt, timezone)}
        </span>
      </header>

      <p className="mt-1.5 text-[13px] text-ink">
        {row.summary ?? row.eventKind.replace(/_/g, ' ')}
      </p>
      <p className="mt-0.5 text-[12px] text-ink-muted">{row.reason}</p>

      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            startTransition(async () => {
              const result = await acknowledgeEvent(row.id);
              onDone(result.error ?? 'Left closed.');
            })
          }
        >
          Leave it closed
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() =>
            startTransition(async () => {
              const result = await reopenApplication(row.applicationId, 'in_process');
              onDone(result.error ?? 'Reopened as in process.');
            })
          }
        >
          They really did come back — reopen
        </Button>
      </footer>
    </>
  );
}
