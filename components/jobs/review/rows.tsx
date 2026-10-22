'use client';

import { useCallback, useState, useTransition } from 'react';
import { CircleAlert, ExternalLink, Mail, Plus, Search } from 'lucide-react';
import { closedToast } from '@/lib/core/lifecycle';
import { CloseButton } from '@/components/inbox/close-button';
import { useToast } from '@/components/ui/toast';
import Link, { linkVariants } from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Kbd } from '@/components/ui/kbd';
import { ActionMenu } from '@/components/ui/action-menu';
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
import { reviewRowLabel } from '@/lib/jobs/review/bulk';
import { guessNewRole } from '@/lib/jobs/review/new-role-guess';
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
 * instead, since that is where its Undo is; a page that drops the row itself
 * passes `onDecline` to hear that it went and that Undo brought it back.
 */
export function ReviewRowBody({
  row,
  timezone,
  busy = false,
  companyNames,
  allRoles,
  onDone,
  onDecline,
  shortcuts = true,
  startOpen,
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
  onDecline?: DeclineHooks;
  /** Whether the 1, 2, 3 beside the suggestions are drawn; only Review binds them. */
  shortcuts?: boolean;
  /** The gallery's way to draw a message with its picker or form already open. */
  startOpen?: MessageOpen;
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
        onDecline={onDecline}
        shortcuts={shortcuts}
        startOpen={startOpen}
      />
    );
  }
  if (row.kind === 'application') {
    return <ApplicationReviewRow row={row} timezone={timezone} busy={busy} onDone={onDone} />;
  }
  return <EventReviewRow row={row} timezone={timezone} busy={busy} onDone={onDone} />;
}

/** What a page that drops a declined row itself is told: it went, and Undo brought it back. */
export type DeclineHooks = { declined: () => void; restored: () => void };

/** Which of a message's two in-place parts is open: the other-role picker or the new-role form. */
export type MessageOpen = 'other-role' | 'new-role';

/**
 * Decline one message (plan #1957.8): it leaves the queue as not relevant,
 * and the toast names it with an Undo that puts back everything the
 * dismissal cleared, the way the bulk bar's does.
 */
export function useDeclineMessage(
  hooks?: DeclineHooks,
): (row: ReviewMessageRow) => Promise<void> {
  const toast = useToast();
  return useCallback(
    async (row) => {
      const result = await dismissMessages([row.id]);
      if (result.error) {
        toast({ text: result.error });
        return;
      }
      hooks?.declined();
      const restore = result.restore;
      toast({
        text: closedToast('declined', reviewRowLabel(row)),
        undo: async () => {
          const back = await restoreDismissedMessages(restore);
          if (back.error) throw new Error(back.error);
          hooks?.restored();
        },
      });
    },
    [toast, hooks],
  );
}

export { reviewRowLabel };

export function MessageReviewRow({
  row,
  timezone,
  busy = false,
  companies,
  allRoles,
  onDone,
  onDecline,
  shortcuts = true,
  startOpen,
}: {
  row: ReviewMessageRow;
  timezone: string;
  busy?: boolean;
  companies: string[];
  allRoles: SearchableRole[];
  onDone: (outcome: ReviewOutcome) => void;
  onDecline?: DeclineHooks;
  shortcuts?: boolean;
  startOpen?: MessageOpen;
}) {
  const [, startTransition] = useTransition();
  const declineMessage = useDeclineMessage(onDecline);
  // One of the two in-place parts open at a time; their presses sit on the
  // footer's one line with Decline and Gmail, so a phone gives a held email
  // one line of controls rather than three (law 9).
  const [open, setOpen] = useState<MessageOpen | null>(startOpen ?? null);

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
            : 'Nothing on file matched this message.'}
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {row.candidates.map((candidate, index) => (
            <li key={candidate.applicationId} className="flex flex-wrap items-center gap-2">
              {shortcuts && <Kbd always>{index + 1}</Kbd>}
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

      {open === 'other-role' && (
        <OtherRolePicker row={row} roles={allRoles} onDone={onDone} onClose={() => setOpen(null)} />
      )}

      {open === 'new-role' && (
        <NewRoleForm row={row} companies={companies} onDone={onDone} onClose={() => setOpen(null)} />
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2 sm:gap-x-3">
        {allRoles.length > 0 && open !== 'other-role' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="max-sm:px-2"
            onClick={() => setOpen('other-role')}
          >
            <Search className="size-3.5 max-sm:hidden" strokeWidth={1.75} aria-hidden />
            <span className="sm:hidden">Other role</span>
            <span className="hidden sm:inline">Some other role — search all {allRoles.length}</span>
          </Button>
        )}
        {open !== 'new-role' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="max-sm:px-2"
            onClick={() => setOpen('new-role')}
          >
            <Plus className="size-3.5 max-sm:hidden" strokeWidth={1.75} aria-hidden />
            <span className="sm:hidden">New role</span>
            <span className="hidden sm:inline">None of these — start a new role</span>
          </Button>
        )}
        <CloseButton
          lifecycle="declined"
          className="max-sm:px-2"
          disabled={busy}
          onClick={() => startTransition(() => declineMessage(row))}
        />
        {row.gmailHref && (
          <GmailAnchor
            href={row.gmailHref}
            target="_blank"
            rel="noreferrer noopener"
            className={cn(linkVariants({ tone: 'quiet' }), 'press-area inline-flex items-center gap-1 text-small')}
          >
            <span className="sm:hidden">Gmail</span>
            <span className="hidden sm:inline">Open in Gmail</span>
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
  onClose,
}: {
  row: ReviewMessageRow;
  roles: SearchableRole[];
  onDone: (outcome: ReviewOutcome) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [pending, startTransition] = useTransition();

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
        className="max-sm:min-h-11"
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
                    if (result.ok) onClose();
                    onDone(result);
                  })
                }
                className="press flex w-full items-start gap-2 rounded-control px-2 py-1.5 text-left transition-colors duration-quick hover:bg-surface disabled:opacity-50 sm:items-center"
              >
                <span className="min-w-0 flex-1 text-ui text-ink sm:truncate">
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

      <Button type="button" variant="ghost" size="sm" onClick={onClose}>
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
  onClose,
}: {
  row: ReviewMessageRow;
  companies: string[];
  onDone: (outcome: ReviewOutcome) => void;
  onClose: () => void;
}) {
  const [guess] = useState(() => guessNewRole(row));
  const [company, setCompany] = useState(guess.company);
  const [title, setTitle] = useState(guess.title);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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
      onClose();
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
          onClick={onClose}
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
        <Chip size="sm">
          <Mail strokeWidth={1.75} aria-hidden />
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
          className={cn(linkVariants(), 'press-area text-ui font-medium')}
        >
          Edit the details
        </Link>
        {/* At 390 the two ways out share one menu, so the row keeps one line
            of controls (law 9); from `sm` up they are buttons as before. */}
        <span className="ml-auto sm:hidden">
          <ActionMenu
            label={`More for ${row.companyName} · ${row.roleTitle}`}
            items={[
              {
                id: 'not-relevant',
                label: 'Not relevant',
                disabled: busy,
                onSelect: () => act(() => removeImported(row.applicationId)),
              },
              ...(row.companyDomains.length > 0
                ? [
                    {
                      id: 'exclude',
                      label: `Exclude ${row.companyName}`,
                      disabled: busy,
                      onSelect: () => act(() => excludeImportedCompany(row.applicationId)),
                    },
                  ]
                : []),
            ]}
          />
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="max-sm:hidden"
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
            className="max-sm:hidden"
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
          <CircleAlert strokeWidth={1.75} aria-hidden />
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
          <span className="sm:hidden">Reopen it</span>
          <span className="hidden sm:inline">They really did come back — reopen</span>
        </Button>
      </footer>
    </>
  );
}
