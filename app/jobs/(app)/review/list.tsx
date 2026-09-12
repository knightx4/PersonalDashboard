'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState, useTransition } from 'react';
import { ExternalLink, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { PageHeader } from '@/components/shell/page-header';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import {
  SelectionActionBar,
  SelectionCheckbox,
  SelectionProvider,
  useSelection,
  useSelectionRowClass,
} from '@/components/ui/selection';
import { countNoun, useBatchWrite } from '@/lib/use-batch-write';
import { Group } from '@/components/ui/disclosure';
import { Field, FieldError, Input } from '@/components/ui/field';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { formatDate } from '@/lib/jobs/applications/load';
import {
  classificationLabel,
  matchRoles,
  REVIEW_VIEWS,
  type ReviewCounts,
  type ReviewRow,
  type ReviewView,
  type SearchableRole,
} from '@/lib/jobs/review/load';
import { jobsSelectionTargets, reviewRowKey } from '@/lib/jobs/review/bulk';
import { domainFromAddress } from '@/lib/jobs/email/ats-senders';
import { usableCompanyName } from '@/lib/jobs/email/link';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import {
  acknowledgeEvent,
  acknowledgeEvents,
  confirmApplication,
  createRoleFromMessage,
  deleteInferredApplication,
  dismissMessage,
  dismissMessages,
  excludeCompanyForApplication,
  linkMessage,
  reopenApplication,
  restoreDismissedMessages,
  unacknowledgeEvents,
  type DismissedMessage,
} from './actions';

/**
 * Keyboard-first, because the queue is worked in bursts.
 *
 *   j / k or arrows   move between rows
 *   x                 select the row the keyboard is on
 *   esc               clear the selection
 *   1 2 3             link to the first, second or third candidate
 *   d                 dismiss
 *   enter             confirm (on an inferred application)
 *
 * Moving, selecting and clearing belong to the shared selection, and so does
 * the page's one keydown listener: the keys below arrive through its `onKey`
 * rather than through a second listener keeping a cursor of its own. x selects
 * here the way it does everywhere else, which is what #234 settled, and the
 * key that dismisses one row is now d.
 */
export function ReviewQueue({
  rows,
  counts,
  view,
  timezone,
  companyNames,
  allRoles,
}: {
  rows: ReviewRow[];
  counts: ReviewCounts;
  view: ReviewView;
  timezone: string;
  /** Every company on file, so starting a new role from a message is a pick. */
  companyNames: string[];
  /** Every pursuit on file, for linking to one the top three did not offer. */
  allRoles: SearchableRole[];
}) {
  const [busy, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const selectionRows = useMemo(() => rows.map((row) => ({ key: reviewRowKey(row) })), [rows]);

  const onKey = useCallback(
    (event: KeyboardEvent, focused: string | null) => {
      const row = rows.find((entry) => reviewRowKey(entry) === focused);
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

      if (event.key === 'd') {
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
    },
    [rows],
  );

  return (
    <SelectionProvider rows={selectionRows} onKey={onKey}>
      <PageHeader
        title="Review"
        description={`${counts.all} waiting. Holding rather than guessing is what keeps the funnel worth reading.`}
        bulk={<JobsBulkBar rows={rows} />}
      />

      <div className="flex flex-col gap-4 xl:flex-row xl:gap-6">
        <LeftRail>
          <RailGroup label="Kind">
            {REVIEW_VIEWS.map((entry) => (
              <RailItem
                key={entry.id}
                label={entry.label}
                href={entry.id === 'all' ? '/jobs/review' : `/jobs/review?view=${entry.id}`}
                active={view === entry.id}
                count={counts[entry.id]}
              />
            ))}
          </RailGroup>
          <p className="px-1 text-small leading-relaxed text-ink-muted">
            Bodies are never stored, so each row links out to Gmail for the full message.
          </p>
        </LeftRail>

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-small text-ink-muted">
            <kbd className="rounded border border-border bg-surface px-1">j</kbd>/
            <kbd className="rounded border border-border bg-surface px-1">k</kbd> to move,{' '}
            <kbd className="rounded border border-border bg-surface px-1">x</kbd> to select,{' '}
            <kbd className="rounded border border-border bg-surface px-1">1</kbd>–
            <kbd className="rounded border border-border bg-surface px-1">3</kbd> to link,{' '}
            <kbd className="rounded border border-border bg-surface px-1">d</kbd> to dismiss.
          </p>

          {message && (
            <p role="status" className="rounded-lg bg-accent-tint px-3 py-2 text-ui text-accent">
              {message}
            </p>
          )}

          {rows.map((row) => (
            <QueueRow
              key={reviewRowKey(row)}
              row={row}
              timezone={timezone}
              busy={busy}
              companyNames={companyNames}
              allRoles={allRoles}
              onDone={setMessage}
            />
          ))}
        </div>
      </div>
    </SelectionProvider>
  );
}

/**
 * Dismiss for the selected messages, Acknowledge for the selected events, each
 * saying how many rows it covers. An inferred application takes neither: what
 * to do with one is a decision about that pursuit, and its row keeps its own
 * buttons.
 */
function JobsBulkBar({ rows }: { rows: ReviewRow[] }) {
  const selection = useSelection();
  const { run, pending } = useBatchWrite();
  const { messageIds, eventIds } = jobsSelectionTargets(rows, (key) =>
    Boolean(selection?.isSelected(key)),
  );

  function dismissSelected() {
    // Everything the dismissal clears, so the undo can put it back. `write`
    // fills it in and `undo` reads it, and the undo cannot run until the write
    // is through and the toast is up.
    let restore: DismissedMessage[] = [];
    run({
      ids: messageIds,
      verb: 'Dismissed',
      one: 'message',
      write: async (ids) => {
        const result = await dismissMessages([...ids]);
        restore = result.restore;
        return result;
      },
      undo: () => restoreDismissedMessages(restore),
    });
  }

  function acknowledgeSelected() {
    run({
      ids: eventIds,
      verb: 'Acknowledged',
      one: 'event',
      write: (ids) => acknowledgeEvents([...ids]),
      undo: (changed) => unacknowledgeEvents(changed),
    });
  }

  return (
    <SelectionActionBar>
      {messageIds.length > 0 && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          pending={pending}
          onClick={dismissSelected}
        >
          Dismiss {countNoun(messageIds.length, 'message')}
        </Button>
      )}
      {eventIds.length > 0 && (
        <Button type="button" size="sm" pending={pending} onClick={acknowledgeSelected}>
          Acknowledge {countNoun(eventIds.length, 'event')}
        </Button>
      )}
    </SelectionActionBar>
  );
}

/** What the row is, for the tick box's name. */
function rowLabel(row: ReviewRow): string {
  if (row.kind === 'message') return row.subject?.trim() || 'message without a subject';
  if (row.kind === 'application') return `${row.companyName} · ${row.roleTitle}`;
  return row.summary?.trim() || `${row.eventKind} at ${row.companyName}`;
}

function QueueRow({
  row,
  timezone,
  busy,
  companyNames,
  allRoles,
  onDone,
}: {
  row: ReviewRow;
  timezone: string;
  busy: boolean;
  companyNames: string[];
  allRoles: SearchableRole[];
  onDone: (message: string) => void;
}) {
  const key = reviewRowKey(row);
  const selection = useSelection();
  const className = useSelectionRowClass(
    key,
    cn(cardVariants({ padding: 'dense' }), 'flex items-start gap-3 transition-colors duration-150'),
  );

  return (
    <article className={className} onClick={() => selection?.focus(key)}>
      <SelectionCheckbox rowKey={key} label={rowLabel(row)} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        {row.kind === 'message' && (
          <MessageRow
            row={row}
            timezone={timezone}
            busy={busy}
            companyCount={companyNames.length}
            companies={companyNames}
            allRoles={allRoles}
            onDone={onDone}
          />
        )}
        {row.kind === 'application' && (
          <ApplicationRow row={row} timezone={timezone} busy={busy} onDone={onDone} />
        )}
        {row.kind === 'event' && (
          <EventRow row={row} timezone={timezone} busy={busy} onDone={onDone} />
        )}
      </div>
    </article>
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
      {/*
       * The subject takes the line; everything that classifies it goes under.
       *
       * All three of these headers were chip, title, badge, date on one
       * `flex-wrap` row, and the title was the only `flex-1 min-w-0` item in
       * it -- so it never wrapped, it shrank. At 390px that left a company
       * called "Starli...", five characters of the only thing on the row that
       * says which pursuit this is, so that a chip, a status badge and a year
       * could all be read in full. `order-first` + `w-full` below `sm` gives
       * the identity the line and lets the labels wrap beneath it; from `sm`
       * up nothing changes at all.
       */}
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded-full bg-canvas px-2 py-0.5 text-micro font-medium text-ink-muted">
          {classificationLabel(row.classification)}
        </span>
        <h3 className="order-first w-full min-w-0 truncate text-ui font-medium text-ink sm:order-none sm:w-auto sm:flex-1">
          {row.subject ?? '(no subject)'}
        </h3>
        <span className="tabular text-small text-ink-muted">
          {formatDate(row.receivedAt, timezone)}
        </span>
      </header>

      <p className="mt-0.5 truncate text-small text-ink-muted">
        {row.fromAddress ?? 'unknown sender'}
      </p>
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
              <kbd className="rounded border border-border bg-canvas px-1.5 text-small text-ink-muted">
                {index + 1}
              </kbd>
              <div className="min-w-0 flex-1">
                <p className="truncate text-ui text-ink">{candidate.label}</p>
                <p className="truncate text-small text-ink-muted">
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
            className="inline-flex items-center gap-1 text-small text-ink-muted underline underline-offset-2 transition-colors duration-150 hover:text-ink"
          >
            Open in Gmail
            <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-3"
        onClick={() => setOpen(true)}
      >
        <Search className="size-3.5" strokeWidth={1.75} aria-hidden />
        Some other role — search all {roles.length}
      </Button>
    );
  }

  const matches = matchRoles(roles, query);

  return (
    // A heading and space, not a panel. This opens inside the queue's own card,
    // where a bordered box was the second frame in and the field's caption said
    // the same thing the heading above it now says once. Law 11.
    <Group title="Link to another role" className="mt-3">
      <Input
        id={`other-role-${row.id}`}
        autoFocus
        value={query}
        disabled={pending}
        placeholder="Company or role title"
        aria-label="Search every role by company or title"
        onChange={(event) => setQuery(event.target.value)}
      />

      {matches.length === 0 ? (
        <p className="text-small text-ink-muted">No role matches that.</p>
      ) : (
        <ul className="space-y-1">
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
                className="press flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-surface disabled:opacity-50"
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

      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </Group>
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="mt-3"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
        None of these — start a new role
      </Button>
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
    // Same call as the picker above: the line that was already acting as a
    // heading becomes the Group's, and the frame around it comes off. The two
    // fields keep their captions -- a multi-field create is the case law 12
    // names as its own exception, and a bare company name is not self-describing.
    <Group title="Start a new role from this message" className="mt-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Field id={`company-${row.id}`} label="Company">
            <Input
              id={`company-${row.id}`}
              list="review-companies"
              value={company}
              disabled={pending}
              onChange={(event) => setCompany(event.target.value)}
            />
          </Field>
          <datalist id="review-companies">
            {companies.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
        <Field id={`title-${row.id}`} label="Role">
          <Input
            id={`title-${row.id}`}
            value={title}
            disabled={pending}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" pending={pending} onClick={submit}>
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
      </div>
      <FieldError>{error}</FieldError>
      <p className="text-small text-ink-muted">
        No applied date is set: this message writes the event its kind implies, and the status
        follows from that.
      </p>
    </Group>
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
      {/* Identity first below `sm`; see the note on the message header. */}
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded-full bg-accent-tint px-2 py-0.5 text-micro font-medium text-accent">
          Created from email
        </span>
        <h3 className="order-first w-full min-w-0 truncate text-ui font-medium text-ink sm:order-none sm:w-auto sm:flex-1">
          {row.companyName} · {row.roleTitle}
        </h3>
        <StatusBadge
          status={row.status as ApplicationStatus}
          everSubmitted={row.submittedAt !== null}
        />
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
          className="text-ui font-medium text-accent hover:underline"
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
      {/* Identity first below `sm`; see the note on the message header. */}
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="rounded-full bg-caution-tint px-2 py-0.5 text-micro font-medium text-ink">
          Arrived after it closed
        </span>
        <h3 className="order-first w-full min-w-0 truncate text-ui font-medium text-ink sm:order-none sm:w-auto sm:flex-1">
          {row.companyName} · {row.roleTitle}
        </h3>
        <StatusBadge status={row.status as ApplicationStatus} />
        <span className="tabular text-small text-ink-muted">
          {formatDate(row.occurredAt, timezone)}
        </span>
      </header>

      <p className="mt-1.5 text-ui text-ink">{row.summary ?? row.eventKind.replace(/_/g, ' ')}</p>
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
