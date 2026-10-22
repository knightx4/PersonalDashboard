'use client';

import { useCallback, useState, useTransition } from 'react';
import { ExternalLink, Plus, Search } from 'lucide-react';
import { closedToast } from '@/lib/core/lifecycle';
import { CloseButton } from '@/components/inbox/close-button';
import { useToast } from '@/components/ui/toast';
import Link, { linkVariants } from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Kbd } from '@/components/ui/kbd';
import { Group } from '@/components/ui/disclosure';
import { Field, FieldError, Input } from '@/components/ui/field';
import { GmailAnchor } from '@/components/ui/gmail-anchor';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { formatDate } from '@/lib/jobs/applications/load';
import {
  classificationLabel,
  matchRoles,
  type ReviewApplicationRow,
  type ReviewEventRow,
  type ReviewMessageRow,
  type ReviewRow,
  type SearchableRole,
} from '@/lib/jobs/review/load';
import { domainFromAddress } from '@/lib/jobs/email/ats-senders';
import { usableCompanyName } from '@/lib/jobs/email/link';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import { dismissMessages, restoreDismissedMessages } from '@/app/jobs/(app)/review/actions';
import {
  acknowledgeLateEvent,
  confirmImported,
  excludeImportedCompany,
  linkToRole,
  reopenFromEvent,
  removeImported,
  startRoleFromMessage,
  type ReviewOutcome,
} from './handlers';

/**
 * The body of one review row: a held message, an application the inbox
 * created from mail, or an event that arrived after its pursuit closed, each
 * with its own buttons. The Review page draws it inside its selectable card;
 * the Jobs Inbox draws it inside its own row (plan #2502).
 *
 * `onDone` hears every button's outcome. A decline reports through its toast
 * instead, since that is where its Undo is.
 */
export function ReviewRowBody({
  row,
  timezone,
  busy = false,
  companyNames,
  allRoles,
  onDone,
}: {
  row: ReviewRow;
  timezone: string;
  /** Holds every button while the page is working on a row. */
  busy?: boolean;
  /** Every company on file, so starting a new role from a message is a pick. */
  companyNames: string[];
  /** Every pursuit on file, for linking to one the top three did not offer. */
  allRoles: SearchableRole[];
  onDone: (outcome: ReviewOutcome) => void;
}) {
  if (row.kind === 'message') {
    return (
      <MessageReviewRow
        row={row}
        timezone={timezone}
        busy={busy}
        companies={companyNames}
        allRoles={allRoles}
        onDone={onDone}
      />
    );
  }
  if (row.kind === 'application') {
    return <ApplicationReviewRow row={row} timezone={timezone} busy={busy} onDone={onDone} />;
  }
  return <EventReviewRow row={row} timezone={timezone} busy={busy} onDone={onDone} />;
}

/**
 * Decline one message (plan #1957.8): it leaves the queue as not relevant,
 * and the toast names it with an Undo that puts back everything the
 * dismissal cleared, the way the bulk bar's does.
 */
export function useDeclineMessage(): (row: ReviewMessageRow) => Promise<void> {
  const toast = useToast();
  return useCallback(
    async (row) => {
      const result = await dismissMessages([row.id]);
      if (result.error) {
        toast({ text: result.error });
        return;
      }
      const restore = result.restore;
      toast({
        text: closedToast('declined', reviewRowLabel(row)),
        undo: async () => {
          const back = await restoreDismissedMessages(restore);
          if (back.error) throw new Error(back.error);
        },
      });
    },
    [toast],
  );
}

/** What the row is, in a few words: the tick box's name and the toast's. */
export function reviewRowLabel(row: ReviewRow): string {
  if (row.kind === 'message') return row.subject?.trim() || 'message without a subject';
  if (row.kind === 'application') return `${row.companyName} · ${row.roleTitle}`;
  return row.summary?.trim() || `${row.eventKind} at ${row.companyName}`;
}

export function MessageReviewRow({
  row,
  timezone,
  busy = false,
  companies,
  allRoles,
  onDone,
}: {
  row: ReviewMessageRow;
  timezone: string;
  busy?: boolean;
  companies: string[];
  allRoles: SearchableRole[];
  onDone: (outcome: ReviewOutcome) => void;
}) {
  const [, startTransition] = useTransition();
  const declineMessage = useDeclineMessage();

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
        <Chip size="sm">{classificationLabel(row.classification)}</Chip>
        <h3 className="order-first w-full min-w-0 line-clamp-2 sm:truncate text-ui font-medium text-ink sm:order-none sm:w-auto sm:flex-1">
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
          {companies.length === 0
            ? 'No companies on file yet, so there is nothing to match against. Add a role and this becomes linkable.'
            : 'No pursuits to link this to yet.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {row.candidates.map((candidate, index) => (
            <li key={candidate.applicationId} className="flex flex-wrap items-center gap-2">
              <Kbd always>{index + 1}</Kbd>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-ui text-ink sm:truncate">{candidate.label}</p>
                <p className="text-small text-ink-muted sm:truncate">
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
                    onDone(await linkToRole(row.id, candidate.applicationId, candidate.label));
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
        <CloseButton
          lifecycle="declined"
          disabled={busy}
          onClick={() => startTransition(() => declineMessage(row))}
        />
        {row.gmailHref && (
          <GmailAnchor
            href={row.gmailHref}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(linkVariants({ tone: 'quiet' }), 'inline-flex items-center gap-1 text-small')}
          >
            Open in Gmail
            <ExternalLink className="size-3.5" strokeWidth={1.75} aria-hidden />
          </GmailAnchor>
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
  row: ReviewMessageRow;
  roles: SearchableRole[];
  onDone: (outcome: ReviewOutcome) => void;
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
                    const result = await linkToRole(row.id, role.applicationId, label);
                    if (result.ok) setOpen(false);
                    onDone(result);
                  })
                }
                className="press flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-quick hover:bg-surface disabled:opacity-50"
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
  row: ReviewMessageRow;
  companies: string[];
  onDone: (outcome: ReviewOutcome) => void;
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
      const result = await startRoleFromMessage({
        messageId: row.id,
        companyName: company,
        title,
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      onDone(result);
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
function suggestedCompany(row: ReviewMessageRow): string {
  const display = row.fromAddress?.match(/^\s*"?([^"<]+?)"?\s*</)?.[1];
  const domain = domainFromAddress(row.fromAddress);
  return usableCompanyName(display) ?? usableCompanyName(domain) ?? '';
}

/** The subject with the usual mail furniture off the front. */
function suggestedTitle(row: ReviewMessageRow): string {
  const subject = (row.subject ?? '').replace(/^\s*((re|fwd|fw)\s*:\s*)+/i, '').trim();
  return subject.slice(0, 200);
}

export function ApplicationReviewRow({
  row,
  timezone,
  busy = false,
  onDone,
}: {
  row: ReviewApplicationRow;
  timezone: string;
  busy?: boolean;
  onDone: (outcome: ReviewOutcome) => void;
}) {
  const [, startTransition] = useTransition();
  const act = (run: () => Promise<ReviewOutcome>) =>
    startTransition(async () => {
      onDone(await run());
    });

  return (
    <>
      {/* Identity first below `sm`; see the note on the message header. */}
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Chip tone="accent" size="sm">
          Created from email
        </Chip>
        <h3 className="order-first w-full min-w-0 line-clamp-2 sm:truncate text-ui font-medium text-ink sm:order-none sm:w-auto sm:flex-1">
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
          onClick={() => act(() => confirmImported(row.applicationId))}
        >
          Looks right
        </Button>
        <Link
          href={`/jobs/roles/${row.roleId}`}
          className={cn(linkVariants(), 'text-ui font-medium')}
        >
          Edit the details
        </Link>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => act(() => removeImported(row.applicationId))}
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
            onClick={() => act(() => excludeImportedCompany(row.applicationId))}
          >
            Exclude {row.companyName}
          </Button>
        )}
      </footer>
    </>
  );
}

export function EventReviewRow({
  row,
  timezone,
  busy = false,
  onDone,
}: {
  row: ReviewEventRow;
  timezone: string;
  busy?: boolean;
  onDone: (outcome: ReviewOutcome) => void;
}) {
  const [, startTransition] = useTransition();
  const act = (run: () => Promise<ReviewOutcome>) =>
    startTransition(async () => {
      onDone(await run());
    });

  return (
    <>
      {/* Identity first below `sm`; see the note on the message header. */}
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Chip tone="caution" size="sm">
          Arrived after it closed
        </Chip>
        <h3 className="order-first w-full min-w-0 line-clamp-2 sm:truncate text-ui font-medium text-ink sm:order-none sm:w-auto sm:flex-1">
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
          onClick={() => act(() => acknowledgeLateEvent(row.id))}
        >
          Leave it closed
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => act(() => reopenFromEvent(row.applicationId))}
        >
          They really did come back — reopen
        </Button>
      </footer>
    </>
  );
}
