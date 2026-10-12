'use client';

import { useState, useTransition } from 'react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDate } from '@/lib/jobs/applications/load';
import { declineCandidateMessage, linkCandidateMessage, searchUnlinkedMessages, unlinkMessage } from './mail-actions';
import { Input, Label } from '@/components/ui/field';
import { INTERVIEW_MAIL, type InterviewSeed, GmailLink } from './shared';
import type { PanelProps } from './types';

export function LinkedMail(props: PanelProps & { onAddInterview: (seed: InterviewSeed) => void }) {
  const { messages, timezone, applicationId, companyName, matchCandidates, onAddInterview } = props;

  return (
    <div className="space-y-4">
      <MatchCandidates
        applicationId={applicationId}
        companyName={companyName}
        candidates={matchCandidates}
        timezone={timezone}
      />

      {messages.length === 0 ? (
        <p
          className={cn(
            cardVariants(),
            'border-dashed px-4 py-10 text-center text-ui text-ink-muted',
          )}
        >
          No mail has been linked to this pursuit yet.
        </p>
      ) : (
        <div>
          <Table>
            <THead>
              <TR>
                <TH>Received</TH>
                <TH>Subject</TH>
                <TH>Kind</TH>
                <TH>Linked by</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {messages.map((message) => (
                <TR key={message.id}>
                  <TD muted label="Received" className="tabular whitespace-nowrap">
                    {formatDate(message.receivedAt, timezone)}
                  </TD>
                  <TD primary label="Subject">
                    {message.gmailHref ? (
                      <GmailLink href={message.gmailHref}>
                        {message.subject ?? '(no subject)'}
                      </GmailLink>
                    ) : (
                      (message.subject ?? '—')
                    )}
                  </TD>
                  <TD muted label="Kind">
                    {message.classification.replace(/_/g, ' ')}
                  </TD>
                  <TD muted label="Linked by" className="tabular">
                    {message.linkMethod?.replace(/_/g, ' ') ?? '—'}
                    {message.linkConfidence !== null &&
                      ` (${Math.round(message.linkConfidence * 100)}%)`}
                  </TD>
                  <TD className="text-right">
                    <span className="inline-flex items-center gap-3">
                      {INTERVIEW_MAIL.has(message.classification) && (
                        <button
                          type="button"
                          onClick={() =>
                            onAddInterview({
                              kind: 'recruiter_screen',
                              fromSubject: message.subject,
                            })
                          }
                          className="whitespace-nowrap text-small text-ink-muted underline underline-offset-2 transition-colors duration-quick hover:text-accent"
                        >
                          Add interview
                        </button>
                      )}
                      <UnlinkMessage messageId={message.id} applicationId={applicationId} />
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <p className="mt-2 text-small text-ink-muted">
            Subjects and senders only. Message bodies are never stored.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * "Not this pursuit." The message returns to the review queue with the events
 * it wrote here removed, so the status stops being derived from mail this role
 * no longer claims. Confirmed first: it is the one row action that changes the
 * timeline.
 */
function UnlinkMessage({ messageId, applicationId }: { messageId: string; applicationId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-small text-danger">{error}</span>}
      <ConfirmStep
        variant="ghost"
        size="sm"
        prompt="It goes back to the review queue, and anything it added to this timeline is removed."
        confirmLabel="Unlink"
        pendingLabel="Unlinking…"
        disabled={pending}
        onConfirm={async () => {
          startTransition(async () => {
            const result = await unlinkMessage(messageId, applicationId);
            setError(result.error);
          });
        }}
      >
        Unlink
      </ConfirmStep>
    </span>
  );
}

/**
 * Unlinked mail that mentions the company, offered to approve or wave off
 * rather than linked automatically. Collapsed by default so a pursuit with
 * nothing pending does not open to a wall of maybes.
 */
function MatchCandidates({
  applicationId,
  companyName,
  candidates,
  timezone,
}: {
  applicationId: string;
  companyName: string;
  candidates: PanelProps['matchCandidates'];
  timezone: string;
}) {
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [, startTransition] = useTransition();

  const visible = candidates.filter((candidate) => !handled.has(candidate.id));

  function decide(
    id: string,
    action: (messageId: string, applicationId: string) => Promise<{ error: string | null }>,
  ) {
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const result = await action(id, applicationId);
      if (result.error) setError(result.error);
      else setHandled((prev) => new Set(prev).add(id));
      setPendingId(null);
    });
  }

  return (
    <div className="space-y-2">
      {visible.length > 0 && (
        // The shared fold, in the shared card. Hand-rolled until the sweep: its
        // own summary, its own padding and no chevron, where every other fold
        // in the app has one. The count moves to the primitive's `meta`, which
        // is what law 10 asks the closed line to carry.
        <Card padding="dense">
          <Disclosure title="Possible matches" meta={`${visible.length} unlinked`}>
            <div className="space-y-2">
              <p className="text-small text-ink-muted">
                Unlinked mail mentioning {companyName}. Approve what belongs here, or say it is not
                a match and it will not be suggested again for this pursuit.
              </p>
              <ul className="divide-y divide-border">
                {visible.map((candidate) => (
                  <MatchRow
                    key={candidate.id}
                    message={candidate}
                    timezone={timezone}
                    busy={pendingId === candidate.id}
                    onDecline={() => decide(candidate.id, declineCandidateMessage)}
                    onLink={() => decide(candidate.id, linkCandidateMessage)}
                  />
                ))}
              </ul>
            </div>
          </Disclosure>
        </Card>
      )}

      {error && <p className="text-small text-danger">{error}</p>}

      {searching ? (
        <AddOtherSearch
          applicationId={applicationId}
          timezone={timezone}
          onClose={() => setSearching(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setSearching(true)}
          className="text-small font-medium text-accent underline underline-offset-2"
        >
          Add other
        </button>
      )}
    </div>
  );
}

function MatchRow({
  message,
  timezone,
  busy,
  onDecline,
  onLink,
}: {
  message: PanelProps['matchCandidates'][number];
  timezone: string;
  busy: boolean;
  /** Omitted for a plain search result: "not a match" only means something for a suggested candidate. */
  onDecline?: () => void;
  onLink: () => void;
}) {
  return (
    // A row in a list, inside a card that is already a box: the divides on the
    // list do the separating and this stops drawing a box per message. Six
    // suggestions used to be six frames inside one.
    <li className="row-pad flex flex-wrap items-center gap-x-3 gap-y-1 text-ui">
      <span className="tabular w-full text-small text-ink-muted sm:w-32">
        {formatDate(message.receivedAt, timezone)}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink">
        {message.gmailHref ? (
          <GmailLink href={message.gmailHref}>{message.subject ?? '(no subject)'}</GmailLink>
        ) : (
          (message.subject ?? '—')
        )}
      </span>
      <span className="truncate text-small text-ink-muted">{message.fromAddress ?? ''}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {onDecline && (
          <button
            type="button"
            disabled={busy}
            onClick={onDecline}
            className="text-small text-ink-muted underline underline-offset-2 hover:text-ink disabled:opacity-50"
          >
            Not a match
          </button>
        )}
        <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={onLink}>
          Link
        </Button>
      </span>
    </li>
  );
}

/** Manual fallback for a match the company-name search missed. */
function AddOtherSearch({
  applicationId,
  timezone,
  onClose,
}: {
  applicationId: string;
  timezone: string;
  onClose: () => void;
}) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PanelProps['matchCandidates'] | null>(null);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function search() {
    setError(null);
    startTransition(async () => {
      const { results: found, error: searchError } = await searchUnlinkedMessages(
        applicationId,
        term,
      );
      setError(searchError);
      setResults(found);
    });
  }

  function link(id: string) {
    startTransition(async () => {
      const result = await linkCandidateMessage(id, applicationId);
      if (result.error) setError(result.error);
      else setLinked((prev) => new Set(prev).add(id));
    });
  }

  return (
    <div className={cn(cardVariants(), 'border-dashed p-3')}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Label htmlFor="mail-search">Search unlinked mail</Label>
          <Input
            id="mail-search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Subject or sender"
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={pending || term.trim().length < 2}
          onClick={search}
        >
          Search
        </Button>
        <button
          type="button"
          onClick={onClose}
          className="text-small text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          Close
        </button>
      </div>
      {error && <p className="mt-2 text-small text-danger">{error}</p>}
      {results !== null && (
        <ul className="mt-2 space-y-1.5">
          {results.length === 0 && (
            <li className="text-small text-ink-muted">No unlinked mail matches that.</li>
          )}
          {results
            .filter((message) => !linked.has(message.id))
            .map((message) => (
              <MatchRow
                key={message.id}
                message={message}
                timezone={timezone}
                busy={pending}
                onLink={() => link(message.id)}
              />
            ))}
        </ul>
      )}
    </div>
  );
}
