'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, useTransition } from 'react';
import { ExternalLink, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { formatDate } from '@/lib/jobs/applications/load';
import {
  classificationLabel,
  matchRoles,
  type ReviewRow,
  type SearchableRole,
} from '@/lib/jobs/review/load';
import { domainFromAddress } from '@/lib/jobs/email/ats-senders';
import { usableCompanyName } from '@/lib/jobs/email/link';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import {
  acknowledgeEvent,
  confirmApplication,
  createRoleFromMessage,
  deleteInferredApplication,
  dismissMessage,
  excludeCompanyForApplication,
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
  companyNames,
  allRoles,
}: {
  rows: ReviewRow[];
  timezone: string;
  /** Every company on file, so starting a new role from a message is a pick. */
  companyNames: string[];
  /** Every pursuit on file, for linking to one the top three did not offer. */
  allRoles: SearchableRole[];
}) {
  const companyCount = companyNames.length;
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
      <p className="text-micro text-ink-muted">
        <kbd className="rounded border border-border bg-surface px-1">j</kbd>/
        <kbd className="rounded border border-border bg-surface px-1">k</kbd> to move,{' '}
        <kbd className="rounded border border-border bg-surface px-1">1</kbd>–
        <kbd className="rounded border border-border bg-surface px-1">3</kbd> to link,{' '}
        <kbd className="rounded border border-border bg-surface px-1">x</kbd> to dismiss.
      </p>

      {message && (
        <p role="status" className="rounded-lg bg-accent-tint px-3 py-2 text-ui text-accent">
          {message}
        </p>
      )}

      {rows.map((row, index) => (
        <article
          key={`${row.kind}-${row.id}`}
          onClick={() => setCursor(index)}
          className={cn(
            'rounded-card border bg-surface p-4 transition-colors duration-150',
            index === cursor ? 'border-accent ring-2 ring-accent/15' : 'border-border',
          )}
        >
          {row.kind === 'message' && (
            <MessageRow
              row={row}
              timezone={timezone}
              busy={busy}
              companyCount={companyCount}
              companies={companyNames}
              allRoles={allRoles}
              onDone={setMessage}
            />
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
  companies,
  allRoles,
  onDone,
}: {
  row: Extract<ReviewRow, { kind: 'message' }>;
  timezone: string;
  busy: boolean;
  companyCount: number;
  companies: string[];
  allRoles: SearchableRole[];
  onDone: (message: string) => void;
}) {
  const [, startTransition] = useTransition();

  return (
    <>
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="rounded-full bg-canvas px-2 py-0.5 text-micro font-medium text-ink-muted">
          {classificationLabel(row.classification)}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-ui font-medium text-ink">
          {row.subject ?? '(no subject)'}
        </h3>
        <span className="tabular text-small text-ink-muted">
          {formatDate(row.receivedAt, timezone)}
        </span>
      </header>

      <p className="mt-0.5 truncate text-small text-ink-muted">{row.fromAddress ?? 'unknown sender'}</p>
      <p className="mt-1.5 text-small text-ink-muted">{row.reason}</p>

      {row.candidates.length === 0 ? (
        <p className="mt-3 text-ui text-ink-muted">
          {companyCount === 0
            ? 'No companies on file yet, so there is nothing to match against. Add a role and this becomes linkable.'
            : 'No pursuits to link this to yet.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {row.candidates.map((candidate, index) => (
            <li key={candidate.applicationId} className="flex flex-wrap items-center gap-2">
              <kbd className="rounded border border-border bg-canvas px-1.5 text-micro text-ink-muted">
                {index + 1}
              </kbd>
              <div className="min-w-0 flex-1">
                <p className="truncate text-ui text-ink">{candidate.label}</p>
                <p className="truncate text-micro text-ink-muted">
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

      <OtherRolePicker row={row} roles={allRoles} onDone={onDone} />

      <NewRoleForm row={row} companies={companies} onDone={onDone} />

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
            className="inline-flex items-center gap-1 text-small text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Open in Gmail
            <ExternalLink className="size-3" strokeWidth={1.75} />
          </a>
        )}
      </footer>
    </>
  );
}

/**
 * "None of these — but it is one I already have."
 *
 * The three suggestions are ranked by how well the message matches, which is
 * the right default and wrong often enough to matter: a rejection from an
 * agency, or a role whose title the mail never says, scores below three
 * unrelated pursuits. Rather than a select over several hundred rows, this is
 * the same thing a person would do with a filing cabinet — type part of the
 * company or the title, and pick out of what is left.
 */
function OtherRolePicker({
  row,
  roles,
  onDone,
}: {
  row: Extract<ReviewRow, { kind: 'message' }>;
  roles: SearchableRole[];
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pending, startTransition] = useTransition();

  if (roles.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-1 text-small text-ink-muted underline underline-offset-2 hover:text-accent"
      >
        <Search className="size-3.5" strokeWidth={1.75} aria-hidden />
        Some other role — search all {roles.length}
      </button>
    );
  }

  const matches = matchRoles(roles, query);

  return (
    <div className="mt-3 rounded-lg border border-border bg-canvas p-3">
      <Label htmlFor={`other-role-${row.id}`}>Link to another role</Label>
      <Input
        id={`other-role-${row.id}`}
        autoFocus
        value={query}
        disabled={pending}
        placeholder="Company or role title"
        onChange={(event) => setQuery(event.target.value)}
      />

      {matches.length === 0 ? (
        <p className="mt-2 text-small text-ink-muted">No role matches that.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {matches.map((role) => (
            <li key={role.applicationId}>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const label = `${role.companyName} · ${role.roleTitle}`;
                    const result = await linkMessage(row.id, role.applicationId);
                    if (!result.error) setOpen(false);
                    onDone(result.error ?? `Linked to ${label}.`);
                  })
                }
                className="press flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-surface disabled:opacity-50"
              >
                <span className="min-w-0 flex-1 truncate text-ui text-ink">
                  {role.companyName} · {role.roleTitle}
                </span>
                <StatusBadge
                  status={role.status as ApplicationStatus}
                  everSubmitted={role.everSubmitted}
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-2 text-small text-ink-muted underline underline-offset-2 hover:text-ink"
      >
        Cancel
      </button>
    </div>
  );
}

/**
 * "None of these — it is a new one."
 *
 * The queue could only file mail against something already on the board, so
 * anything genuinely new had no move except dismissing it. Company and title
 * are guessed from the sender and the subject and both are editable, because a
 * guess offered for correction is faster than an empty pair of boxes and safer
 * than one written without being seen.
 */
function NewRoleForm({
  row,
  companies,
  onDone,
}: {
  row: Extract<ReviewRow, { kind: 'message' }>;
  companies: string[];
  onDone: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [company, setCompany] = useState(() => suggestedCompany(row));
  const [title, setTitle] = useState(() => suggestedTitle(row));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex items-center gap-1 text-small text-ink-muted underline underline-offset-2 hover:text-accent"
      >
        <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
        None of these — start a new role
      </button>
    );
  }

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createRoleFromMessage({
        messageId: row.id,
        companyName: company,
        title,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      onDone(`Started ${company} · ${title} and linked this message to it.`);
    });
  };

  return (
    <div className="mt-3 rounded-lg border border-border bg-canvas p-3">
      <p className="text-small font-medium text-ink">Start a new role from this message</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`company-${row.id}`}>Company</Label>
          <Input
            id={`company-${row.id}`}
            list="review-companies"
            value={company}
            disabled={pending}
            onChange={(event) => setCompany(event.target.value)}
          />
          <datalist id="review-companies">
            {companies.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <div>
          <Label htmlFor={`title-${row.id}`}>Role</Label>
          <Input
            id={`title-${row.id}`}
            value={title}
            disabled={pending}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={submit}>
          {pending ? 'Creating…' : 'Create and link'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
        {error && <span className="text-small text-status-rejected">{error}</span>}
      </div>
      <p className="mt-2 text-micro text-ink-muted">
        No applied date is set: this message writes the event its kind implies, and the status
        follows from that.
      </p>
    </div>
  );
}

/** The employer, as far as the sender can say. Blank rather than wrong. */
function suggestedCompany(row: Extract<ReviewRow, { kind: 'message' }>): string {
  const display = row.fromAddress?.match(/^\s*"?([^"<]+?)"?\s*</)?.[1];
  const domain = domainFromAddress(row.fromAddress);
  return usableCompanyName(display) ?? usableCompanyName(domain) ?? '';
}

/** The subject with the usual mail furniture off the front. */
function suggestedTitle(row: Extract<ReviewRow, { kind: 'message' }>): string {
  const subject = (row.subject ?? '').replace(/^\s*((re|fwd|fw)\s*:\s*)+/i, '').trim();
  return subject.slice(0, 200);
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
        <span className="rounded-full bg-accent-tint px-2 py-0.5 text-micro font-medium text-accent">
          Created from email
        </span>
        <h3 className="min-w-0 flex-1 truncate text-ui font-medium text-ink">
          {row.companyName} · {row.roleTitle}
        </h3>
        <StatusBadge status={row.status as ApplicationStatus} everSubmitted={row.submittedAt !== null} />
        <span className="tabular text-small text-ink-muted">
          {formatDate(row.submittedAt, timezone)}
        </span>
      </header>

      <p className="mt-1.5 text-small text-ink-muted">{row.reason}</p>

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
          className="text-small text-ink-muted underline underline-offset-2 hover:text-ink"
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
          Not relevant
        </Button>
        {/* Only where the employer has a sending domain of its own on file.
            The one-off verdict never stops the next sync inferring the same
            pursuit again, and answering the same agency every week is how a
            queue stops being worked. */}
        {row.companyDomains.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            title={`Stop hearing from ${row.companyDomains.join(', ')}`}
            onClick={() =>
              startTransition(async () => {
                const result = await excludeCompanyForApplication(row.applicationId);
                onDone(result.error ?? result.message ?? 'Excluded.');
              })
            }
          >
            Exclude {row.companyName}
          </Button>
        )}
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
        <span className="rounded-full bg-caution-tint px-2 py-0.5 text-micro font-medium text-ink">
          Arrived after it closed
        </span>
        <h3 className="min-w-0 flex-1 truncate text-ui font-medium text-ink">
          {row.companyName} · {row.roleTitle}
        </h3>
        <StatusBadge status={row.status as ApplicationStatus} />
        <span className="tabular text-small text-ink-muted">
          {formatDate(row.occurredAt, timezone)}
        </span>
      </header>

      <p className="mt-1.5 text-ui text-ink">
        {row.summary ?? row.eventKind.replace(/_/g, ' ')}
      </p>
      <p className="mt-0.5 text-small text-ink-muted">{row.reason}</p>

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
