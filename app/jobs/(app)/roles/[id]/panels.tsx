'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileText,
  ChevronDown,
  ListChecks,
  Mail,
  MessageSquareText,
  Pencil,
  StickyNote,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { formatCompBand, formatDate, formatDateTime } from '@/lib/jobs/applications/load';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import type { Requirement } from '@/lib/jobs/jd/requirements';
import type { MatchVerdict, RequirementMatch } from '@/lib/jobs/evidence/match-payload';
import type { AnswerDraft } from '@/lib/jobs/evidence/draft-payload';
import {
  addQuestions,
  draftAnswerFromEvidence,
  lookUpJobDescription,
  promoteToCanonical,
  saveAnswer,
  saveDraftedAnswer,
  updateRole,
  type JdLookupResult,
} from '../actions';
import {
  addInterview,
  addInterviewer,
  addNote,
  addReminder,
  declineCandidateMessage,
  deleteInterview,
  linkCandidateMessage,
  linkReminderMessage,
  matchRoleRequirements,
  removeInterviewer,
  saveInterview,
  searchUnlinkedMessages,
  shareCasePage,
  unlinkMessage,
  unshareCasePage,
} from './actions';
import { dismissPursuit } from '@/app/jobs/(app)/pipeline/actions';
import {
  INTERVIEW_KIND_LABEL,
  INTERVIEW_KINDS,
  interviewKindLabel,
} from '@/lib/jobs/interview-kinds';
import { ReminderActions } from '@/app/jobs/(app)/today/reminder-actions';
import { Input, Label, Select } from '@/components/ui/field';

type Tab = 'timeline' | 'posting' | 'answers' | 'interviews' | 'notes' | 'mail';

const TABS: Array<{ id: Tab; label: string; icon: typeof FileText }> = [
  { id: 'timeline', label: 'Timeline', icon: ListChecks },
  { id: 'posting', label: 'Posting', icon: FileText },
  { id: 'answers', label: 'Answers', icon: MessageSquareText },
  { id: 'interviews', label: 'Interviews', icon: CalendarClock },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'mail', label: 'Linked mail', icon: Mail },
];

export interface PanelProps {
  roleId: string;
  applicationId: string;
  jdText: string;
  /** What the last automated board lookup did, or could not do. */
  jdLookupNote: string | null;
  jdUrl: string | null;
  atsJobId: string | null;
  compMinCents: number | null;
  compMaxCents: number | null;
  compSource: string | null;
  requirements: Requirement[];
  /** The stored match, or null if this role has never been matched. */
  requirementMatches: RequirementMatch[] | null;
  requirementMatchesAt: string | null;
  /** The description or the bank has changed since the match was computed. */
  requirementMatchesStale: boolean;
  /** How many items the bank holds. Zero is why a match refuses to run. */
  bankSize: number;
  /** The statement of interest on the shared case page. Written by hand. */
  caseStatement: string;
  /** The live share slug, or null when the page is not shared. */
  caseSlug: string | null;
  caseExpiresAt: string | null;
  appOrigin: string;
  timezone: string;
  /** The interview to scroll to and highlight, arriving from This week. */
  focusInterviewId?: string | null;
  events: Array<{
    id: string;
    kind: string;
    occurredAt: string;
    source: string;
    summary: string | null;
    needsReview: boolean;
    /** Set when this event came from an email that is still in the mailbox. */
    gmailHref: string | null;
  }>;
  interviews: Array<{
    id: string;
    round: number;
    kind: string;
    scheduledAt: string | null;
    /** Computed on the server: reading the clock during render is unstable. */
    debriefDue: boolean;
    format: string | null;
    status: string;
    prepNotes: string;
    notes: string;
    /** Free-form notes written against this round, newest first. */
    customNotes: Array<{ id: string; body: string; createdAt: string }>;
    questionsAsked: string[];
    /** Who is in the room, as contacts rather than as names on a string. */
    participants: Array<{
      contactId: string;
      name: string;
      title: string | null;
      role: string;
    }>;
  }>;
  /** Everyone known at this company, for naming an interviewer without retyping. */
  companyContacts: Array<{ id: string; name: string; title: string | null }>;
  answers: Array<{
    id: string;
    answer: string;
    status: string;
    questionId: string;
    questionText: string;
    questionKind: string;
    canonicalAnswer: string | null;
    timesSeen: number;
    /** What a previous draft cited, and what it could not ground. */
    evidenceItemIds: string[];
    unsupportedClaims: string[];
  }>;
  notes: Array<{ id: string; body: string; pinned: boolean; createdAt: string }>;
  /** Open to-dos you set for yourself, not events the inbox produced. */
  todos: Array<{
    id: string;
    body: string;
    dueAt: string;
    /** The email that asked for it, where one has been named. */
    message: { id: string; subject: string | null; gmailHref: string | null } | null;
  }>;
  messages: Array<{
    id: string;
    subject: string | null;
    fromAddress: string | null;
    receivedAt: string | null;
    classification: string;
    linkMethod: string | null;
    linkConfidence: number | null;
    /** Deep link into the connected mailbox; null once the envelope is scrubbed. */
    gmailHref: string | null;
  }>;
  companyName: string;
  /** Unlinked mail mentioning the company, offered to approve or wave off. */
  matchCandidates: Array<{
    id: string;
    subject: string | null;
    fromAddress: string | null;
    receivedAt: string | null;
    classification: string;
    gmailHref: string | null;
  }>;
  otherAttempts: Array<{
    id: string;
    attempt: number;
    status: ApplicationStatus;
    submittedAt: string | null;
    outcome: string | null;
    rejectionStage: string | null;
  }>;
}

/**
 * Mail that describes an interview rather than merely mentioning one.
 *
 * These are the classifications the ingest path turns into a booking, so they
 * are the ones worth offering a round against when it did not: a scheduling
 * thread hand-linked from the review queue records its event but no interview,
 * and until now that left the Interviews tab silently empty.
 */
const INTERVIEW_MAIL = new Set(['interview_invite', 'scheduling']);

/** What the "Add a round" form should be seeded with, and which mail asked. */
interface InterviewSeed {
  kind: string;
  fromSubject: string | null;
}

export function RoleDetailPanels(props: PanelProps & { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(props.initialTab ?? 'timeline');
  const [interviewSeed, setInterviewSeed] = useState<InterviewSeed | null>(null);

  // Adding the round from a message is one move, not "go to the other tab and
  // find the button": the seed opens the form there already filled in.
  const startInterviewFrom = (seed: InterviewSeed) => {
    setInterviewSeed(seed);
    setTab('interviews');
  };

  return (
    <div>
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((entry) => {
          const active = tab === entry.id;
          const count =
            entry.id === 'answers'
              ? props.answers.length
              : entry.id === 'interviews'
                ? props.interviews.length
                : entry.id === 'notes'
                  ? props.notes.length
                  : entry.id === 'mail'
                    ? props.messages.length
                    : undefined;
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-ui font-medium transition-colors duration-150',
                active
                  ? 'border-accent text-accent'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              <entry.icon className="size-3.5" strokeWidth={1.75} />
              {entry.label}
              {count !== undefined && count > 0 && (
                <span className="tabular text-ink-muted">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'timeline' && <Timeline {...props} />}
      {tab === 'posting' && <Posting {...props} />}
      {tab === 'answers' && <Answers {...props} />}
      {tab === 'interviews' && (
        <Interviews
          {...props}
          seed={interviewSeed}
          onSeedUsed={() => setInterviewSeed(null)}
        />
      )}
      {tab === 'notes' && <Notes {...props} />}
      {tab === 'mail' && <LinkedMail {...props} onAddInterview={startInterviewFrom} />}

      <NotRealPursuit applicationId={props.applicationId} />
    </div>
  );
}

/**
 * The same "this was not real" escape as the board, on the page you land on
 * when you click through to find out what a pursuit even is.
 *
 * Below the fold and behind a confirmation, because it removes the role and
 * usually the company with it. Nothing a person put there is touched: a
 * company with research on it, a contact, or a note survives its pursuit.
 */
function NotRealPursuit({ applicationId }: { applicationId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="mt-8 border-t border-border pt-4">
      {confirming ? (
        <div className="space-y-2">
          <p className="text-ui text-ink">
            Remove this pursuit? The role goes with it, and the company too if nothing else is
            attached to it. Any mail that created it is marked not relevant, so the next sync
            will not bring it back.
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await dismissPursuit(applicationId);
                  if (result.error) setError(result.error);
                  else router.push('/jobs/pipeline');
                })
              }
            >
              {pending ? 'Removing…' : 'Yes, remove it'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
          {error && <p className="text-ui text-status-rejected">{error}</p>}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-small text-ink-muted hover:text-status-rejected hover:underline"
        >
          This was not a real pursuit — remove it
        </button>
      )}
    </div>
  );
}

/**
 * "Open in Gmail" for anything that came from an email.
 *
 * Message bodies are never stored, so a subject line is as far as this app can
 * take you. Handing the rest off to Gmail is the whole point -- the note asked
 * for an actual link, in both places an email is named.
 */
function GmailLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-baseline gap-1 underline decoration-border underline-offset-2 hover:text-accent hover:decoration-accent"
    >
      <span>{children}</span>
      <ExternalLink className="size-3 shrink-0 self-center text-ink-muted" strokeWidth={1.75} aria-hidden />
      <span className="sr-only">Open in Gmail</span>
    </a>
  );
}

function Timeline({ events, timezone, otherAttempts, todos, applicationId, messages }: PanelProps) {
  return (
    <div className="space-y-4">
      <Todos
        todos={todos}
        applicationId={applicationId}
        timezone={timezone}
        messages={messages}
      />

      {otherAttempts.length > 0 && (
        <section className="rounded-card border border-border bg-surface p-4">
          <h3 className="text-ui font-semibold text-ink">Earlier attempts</h3>
          <p className="mt-0.5 text-small text-ink-muted">
            Kept as history rather than overwritten — which is the whole reason a pursuit is a
            separate row from the posting.
          </p>
          <ul className="mt-2 space-y-1.5">
            {otherAttempts.map((attempt) => (
              <li key={attempt.id} className="flex items-center gap-2 text-ui">
                <span className="tabular text-ink-muted">#{attempt.attempt}</span>
                <StatusBadge status={attempt.status} everSubmitted={attempt.submittedAt !== null} />
                <span className="text-ink-muted">{formatDate(attempt.submittedAt, timezone)}</span>
                {attempt.rejectionStage && (
                  <span className="text-ink-muted">at {attempt.rejectionStage}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {events.length === 0 ? (
        <p className="rounded-card border border-dashed border-border bg-surface px-4 py-10 text-center text-ui text-ink-muted">
          Nothing has happened yet. Events appear here as mail arrives, or when you move the card.
        </p>
      ) : (
        <ol className="space-y-2">
          {events.map((event) => (
            <li
              key={event.id}
              className={cn(
                'flex gap-3 rounded-card border border-border bg-surface px-4 py-2.5',
                event.needsReview && 'border-caution bg-caution-tint',
              )}
            >
              <span className="tabular w-28 shrink-0 text-small text-ink-muted">
                {formatDate(event.occurredAt, timezone)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-ui text-ink">
                  {event.gmailHref ? (
                    <GmailLink href={event.gmailHref}>
                      {event.summary ?? event.kind.replace(/_/g, ' ')}
                    </GmailLink>
                  ) : (
                    (event.summary ?? event.kind.replace(/_/g, ' '))
                  )}
                </p>
                <p className="text-micro text-ink-muted">
                  {event.kind.replace(/_/g, ' ')} · {event.source}
                </p>
                {event.needsReview && (
                  <p className="mt-1 flex items-start gap-1.5 text-small text-ink">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-caution" strokeWidth={2} />
                    Recorded, but it did not change the status — that would have moved this
                    backwards.
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Something to do, with a date, that nobody's mail is going to tell you about.
 *
 * Backed by the same `reminders` row the nightly sweep raises, so setting one
 * here is not a second system: it shows up on This week's Nudges once due,
 * and finishing it there clears it here too.
 */
function Todos({
  todos,
  applicationId,
  timezone,
  messages,
}: {
  todos: PanelProps['todos'];
  applicationId: string;
  timezone: string;
  messages: PanelProps['messages'];
}) {
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h3 className="mb-2 text-ui font-semibold text-ink">To-dos</h3>
      {todos.length > 0 && (
        <ul className="mb-3 space-y-2">
          {todos.map((todo) => (
            <li key={todo.id} className="text-ui">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="tabular text-ink-muted">{formatDate(todo.dueAt, timezone)}</span>
                <span className="text-ink">{todo.body}</span>
                <ReminderActions id={todo.id} />
              </div>
              <TodoMail todo={todo} messages={messages} timezone={timezone} />
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1">
          <Label htmlFor="todo-body">Add a to-do</Label>
          <Input
            id="todo-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Record a video interview"
          />
        </div>
        <div>
          <Label htmlFor="todo-due">Done by</Label>
          <Input
            id="todo-due"
            type="date"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            className="w-40"
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={pending || !body.trim() || !dueAt}
          onClick={() =>
            startTransition(async () => {
              const result = await addReminder({ applicationId, body, dueAt });
              setError(result.error);
              if (!result.error) {
                setBody('');
                setDueAt('');
              }
            })
          }
        >
          Add
        </Button>
        {error && <span className="text-small text-status-rejected">{error}</span>}
      </div>
    </section>
  );
}

/**
 * The email a to-do is about.
 *
 * "Submit the take-home" and the mail that sent the take-home were the same
 * thing in two tabs, joined only by remembering the subject line. Named here,
 * the to-do carries the link to the mailbox with it.
 *
 * The picker is the mail already linked to this pursuit, which is the whole of
 * what a to-do on this role could sensibly point at -- and it stays closed
 * until asked for, so a list of to-dos does not become a list of dropdowns.
 */
function TodoMail({
  todo,
  messages,
  timezone,
}: {
  todo: PanelProps['todos'][number];
  messages: PanelProps['messages'];
  timezone: string;
}) {
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(messageId: string | null) {
    startTransition(async () => {
      const result = await linkReminderMessage({ reminderId: todo.id, messageId });
      setError(result.error);
      if (!result.error) setPicking(false);
    });
  }

  if (todo.message) {
    return (
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 pl-0.5 text-small text-ink-muted">
        <Mail className="size-3 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        {todo.message.gmailHref ? (
          <GmailLink href={todo.message.gmailHref}>
            {todo.message.subject ?? '(no subject)'}
          </GmailLink>
        ) : (
          <span>{todo.message.subject ?? 'An email no longer linked to this role'}</span>
        )}
        <button
          type="button"
          disabled={pending}
          onClick={() => save(null)}
          className="text-ink-muted underline underline-offset-2 hover:text-status-rejected disabled:opacity-50"
        >
          Unlink
        </button>
        {error && <span className="text-status-rejected">{error}</span>}
      </p>
    );
  }

  if (messages.length === 0) return null;

  if (!picking) {
    return (
      <button
        type="button"
        onClick={() => setPicking(true)}
        className="mt-0.5 pl-0.5 text-small text-ink-muted underline underline-offset-2 hover:text-accent"
      >
        Link an email
      </button>
    );
  }

  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 pl-0.5 text-small">
      <Select
        aria-label="Email this to-do is about"
        defaultValue=""
        disabled={pending}
        className="max-w-full sm:max-w-[28rem]"
        onChange={(event) => {
          if (event.target.value) save(event.target.value);
        }}
      >
        <option value="">Pick an email…</option>
        {messages.map((message) => (
          <option key={message.id} value={message.id}>
            {formatDate(message.receivedAt, timezone)} — {message.subject ?? '(no subject)'}
          </option>
        ))}
      </Select>
      <button
        type="button"
        onClick={() => setPicking(false)}
        className="text-ink-muted underline underline-offset-2 hover:text-ink"
      >
        Cancel
      </button>
      {error && <span className="text-status-rejected">{error}</span>}
    </p>
  );
}

/**
 * Colour carries the verdict, so a map is readable at a glance without reading
 * every line. Gap is the same red as a rejection on purpose: it is the answer
 * that saves you the hour, not a failure state to be softened.
 */
const VERDICT_STYLE: Record<MatchVerdict, { dot: string; label: string; text: string }> = {
  strong: { dot: 'bg-status-offer', label: 'Strong', text: 'text-status-offer' },
  partial: { dot: 'bg-caution-fill', label: 'Partial', text: 'text-caution' },
  gap: { dot: 'bg-status-rejected', label: 'Gap', text: 'text-status-rejected' },
};

function Posting({
  roleId,
  jdText,
  jdLookupNote,
  jdUrl,
  atsJobId,
  compMinCents,
  compMaxCents,
  compSource,
  requirements,
  requirementMatches,
  requirementMatchesAt,
  requirementMatchesStale,
  bankSize,
  applicationId,
  caseStatement,
  caseSlug,
  caseExpiresAt,
  appOrigin,
  timezone,
}: PanelProps) {
  const groups: Array<{ kind: Requirement['kind']; label: string }> = [
    { kind: 'must_have', label: 'Must have' },
    { kind: 'nice_to_have', label: 'Nice to have' },
    { kind: 'responsibility', label: 'What the role does' },
  ];

  const [matches, setMatches] = useState(requirementMatches);
  const [stale, setStale] = useState(requirementMatchesStale);
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [, startMatch] = useTransition();

  // Keyed by text, because the map is stored as its own list and a description
  // re-extracted since the match can have moved, added or dropped a line. A
  // line with no entry simply renders unmatched, which is the honest reading.
  const verdictFor = new Map((matches ?? []).map((match) => [match.requirement, match]));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-card border border-border bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-ui font-semibold text-ink">Requirement map</h3>
          {requirements.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={matching}
              onClick={() => {
                setMatching(true);
                setMatchError(null);
                startMatch(async () => {
                  const result = await matchRoleRequirements({ roleId });
                  setMatching(false);
                  if (result.error || !result.matches) {
                    setMatchError(result.error ?? 'The match came back empty.');
                    return;
                  }
                  setMatches(result.matches);
                  setStale(false);
                });
              }}
            >
              {matching ? 'Matching…' : matches ? 'Match again' : 'Match my evidence'}
            </Button>
          )}
        </div>
        <p className="mt-0.5 text-small text-ink-muted">
          {matches
            ? 'Your best evidence beside each line. A gap is the useful answer — it is the hour you do not spend.'
            : 'Extracted once from the description. Match it against your bank to see which lines you can actually claim.'}
        </p>

        {matches && requirementMatchesAt && !stale && (
          <p className="mt-1 text-small text-ink-muted">
            Matched {formatDateTime(requirementMatchesAt, timezone)}.
          </p>
        )}
        {stale && (
          <p className="mt-1 text-small text-caution">
            The description or your bank has changed since this was matched.
          </p>
        )}
        {bankSize === 0 && (
          <p className="mt-1 text-small text-ink-muted">
            Your evidence bank is empty, so there is nothing to match against.{' '}
            <Link href="/jobs/settings" className="underline underline-offset-2 hover:text-ink">
              Fill it in Settings.
            </Link>
          </p>
        )}
        {matchError && <p className="mt-1 text-small text-status-rejected">{matchError}</p>}

        {requirements.length === 0 ? (
          <p className="mt-3 text-ui text-ink-muted">
            No description saved yet, so there is nothing to map.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {groups.map((group) => {
              const items = requirements.filter((r) => r.kind === group.kind);
              if (items.length === 0) return null;
              return (
                <div key={group.kind}>
                  <h4 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
                    {group.label}
                  </h4>
                  <ul className="mt-1 space-y-1">
                    {items.map((item, index) => {
                      const match = verdictFor.get(item.text);
                      const style = match ? VERDICT_STYLE[match.verdict] : null;
                      return (
                        <li key={`${group.kind}-${index}`} className="flex gap-2 text-ui text-ink">
                          <span
                            className={cn(
                              'mt-1.5 size-1.5 shrink-0 rounded-full',
                              style ? style.dot : 'bg-border-strong',
                            )}
                            aria-hidden
                          />
                          <span className="min-w-0">
                            {item.text}
                            {match && style && (
                              <span className="block text-small text-ink-muted">
                                <span className={cn('font-medium', style.text)}>{style.label}</span>
                                {' — '}
                                {match.why}
                              </span>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="space-y-4">
        <ShareCaseCard
          applicationId={applicationId}
          statement={caseStatement}
          slug={caseSlug}
          expiresAt={caseExpiresAt}
          appOrigin={appOrigin}
          canShare={(matches ?? []).some((match) => match.verdict !== 'gap')}
          timezone={timezone}
        />

        <RoleDetailsCard
          roleId={roleId}
          jdUrl={jdUrl}
          atsJobId={atsJobId}
          compMinCents={compMinCents}
          compMaxCents={compMaxCents}
          compSource={compSource}
        />

        <JobDescriptionCard roleId={roleId} jdText={jdText} jdLookupNote={jdLookupNote} />
      </div>
    </div>
  );
}

/**
 * The shared case page.
 *
 * The requirement map is already the work; this puts a link on it. A statement
 * of interest goes on top, written by hand -- the map is what makes the page
 * worth sending, and a generated paragraph of enthusiasm above it would undo
 * that. Standalone cover letter generation is dropped for the same reason.
 *
 * Only the covered lines travel. The private map exists to show what you
 * cannot claim; this page exists to show what you can, and the filtering
 * happens in the database so gap lines never leave it.
 */
function ShareCaseCard({
  applicationId,
  statement,
  slug,
  expiresAt,
  appOrigin,
  canShare,
  timezone,
}: {
  applicationId: string;
  statement: string;
  slug: string | null;
  expiresAt: string | null;
  appOrigin: string;
  canShare: boolean;
  timezone: string;
}) {
  const [body, setBody] = useState(statement);
  const [liveSlug, setLiveSlug] = useState(slug);
  const [liveExpiry, setLiveExpiry] = useState(expiresAt);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const url = liveSlug ? `${appOrigin}/jobs/p/${liveSlug}` : null;

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h3 className="text-ui font-semibold text-ink">Share the map</h3>
      <p className="mt-0.5 text-small leading-relaxed text-ink-muted">
        A private link showing this role&rsquo;s requirements with your evidence beside each one. It
        is a work sample and a cover letter in one. Gaps are never on it, and the link expires.
      </p>

      <Label htmlFor={`case-body-${applicationId}`} className="mt-3 block">
        Why you want it
      </Label>
      <Textarea
        id={`case-body-${applicationId}`}
        rows={4}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="A short paragraph, in your words. Nothing writes this for you."
      />

      {url && (
        <div className="mt-3 rounded-lg bg-canvas p-2">
          <p className="break-all font-mono text-micro text-ink">{url}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="text-small text-accent hover:underline"
              onClick={() => {
                navigator.clipboard.writeText(url);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            {liveExpiry && (
              <span className="text-micro text-ink-muted">
                Expires {formatDate(liveExpiry, timezone)}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending || !canShare}
          title={canShare ? undefined : 'Match the requirements first — there is nothing to show yet.'}
          onClick={() => {
            setError(null);
            setCopied(false);
            startTransition(async () => {
              const result = await shareCasePage({ applicationId, body });
              if (result.error) {
                setError(result.error);
                return;
              }
              setLiveSlug(result.slug);
              setLiveExpiry(result.expiresAt);
            });
          }}
        >
          {liveSlug ? 'Save and re-issue the link' : 'Create the link'}
        </Button>

        {liveSlug && (
          <button
            type="button"
            className="text-small text-ink-muted hover:text-status-rejected"
            onClick={() => {
              setError(null);
              startTransition(async () => {
                const result = await unshareCasePage(applicationId);
                if (result.error) {
                  setError(result.error);
                  return;
                }
                setLiveSlug(null);
                setLiveExpiry(null);
                setCopied(false);
              });
            }}
          >
            Stop sharing
          </button>
        )}

        {error && <span className="text-small text-status-rejected">{error}</span>}
      </div>

      {liveSlug && (
        <p className="mt-1.5 text-micro text-ink-muted">
          Re-issuing gives a new link and breaks the old one, which is how you take a shared page
          back.
        </p>
      )}
    </section>
  );
}

/**
 * The link, the ATS requisition id, and the comp band -- editable, because
 * none of them arrive from mail as reliably as the description itself does.
 */
function RoleDetailsCard({
  roleId,
  jdUrl,
  atsJobId,
  compMinCents,
  compMaxCents,
  compSource,
}: {
  roleId: string;
  jdUrl: string | null;
  atsJobId: string | null;
  compMinCents: number | null;
  compMaxCents: number | null;
  compSource: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [jdUrlDraft, setJdUrlDraft] = useState(jdUrl ?? '');
  const [atsJobIdDraft, setAtsJobIdDraft] = useState(atsJobId ?? '');
  const [compMinDraft, setCompMinDraft] = useState(
    compMinCents !== null ? String(Math.round(compMinCents / 100)) : '',
  );
  const [compMaxDraft, setCompMaxDraft] = useState(
    compMaxCents !== null ? String(Math.round(compMaxCents / 100)) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const compBand = formatCompBand(compMinCents, compMaxCents);

  const save = () => {
    setError(null);
    const min = compMinDraft.trim() ? Math.round(Number(compMinDraft) * 100) : null;
    const max = compMaxDraft.trim() ? Math.round(Number(compMaxDraft) * 100) : null;
    if ((min !== null && !Number.isFinite(min)) || (max !== null && !Number.isFinite(max))) {
      setError('Compensation has to be a number.');
      return;
    }
    startTransition(async () => {
      const result = await updateRole(roleId, {
        jdUrl: jdUrlDraft.trim() || null,
        atsJobId: atsJobIdDraft.trim() || null,
        compMinCents: min,
        compMaxCents: max,
        compSource:
          min !== null || max !== null
            ? ((compSource ?? 'recruiter') as 'posted' | 'recruiter' | 'estimate')
            : null,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  if (!editing) {
    return (
      <section className="rounded-card border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-ui font-semibold text-ink">Details</h3>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-ink-muted hover:text-ink"
            title="Edit posting details"
          >
            <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <dl className="mt-2 space-y-1.5 text-ui">
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 text-ink-muted">Posting link</dt>
            <dd className="min-w-0 flex-1 truncate">
              {jdUrl ? (
                <a
                  href={jdUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent underline underline-offset-2"
                >
                  {jdUrl}
                </a>
              ) : (
                <span className="text-ink-muted">—</span>
              )}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 text-ink-muted">ATS job id</dt>
            <dd className="text-ink">{atsJobId ?? <span className="text-ink-muted">—</span>}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 text-ink-muted">Compensation</dt>
            <dd className="text-ink">
              {compBand ?? <span className="text-ink-muted">—</span>}
              {compBand && compSource && (
                <span className="ml-1.5 text-small text-ink-muted">from the {compSource}</span>
              )}
            </dd>
          </div>
        </dl>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h3 className="text-ui font-semibold text-ink">Details</h3>
      <div className="mt-2 space-y-2">
        <div>
          <Label htmlFor={`jdurl-${roleId}`}>Posting link</Label>
          <Input
            id={`jdurl-${roleId}`}
            type="url"
            value={jdUrlDraft}
            onChange={(event) => setJdUrlDraft(event.target.value)}
            placeholder="https://…"
          />
        </div>
        <div>
          <Label htmlFor={`ats-${roleId}`}>ATS job id</Label>
          <Input
            id={`ats-${roleId}`}
            value={atsJobIdDraft}
            onChange={(event) => setAtsJobIdDraft(event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor={`compmin-${roleId}`}>Comp min ($)</Label>
            <Input
              id={`compmin-${roleId}`}
              type="number"
              value={compMinDraft}
              onChange={(event) => setCompMinDraft(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor={`compmax-${roleId}`}>Comp max ($)</Label>
            <Input
              id={`compmax-${roleId}`}
              type="number"
              value={compMaxDraft}
              onChange={(event) => setCompMaxDraft(event.target.value)}
            />
          </div>
        </div>
      </div>
      {error && <p className="mt-2 text-ui text-status-rejected">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => setEditing(false)}
        >
          Cancel
        </Button>
      </div>
    </section>
  );
}

/**
 * The description itself. Pasting one re-extracts the requirement map and,
 * when the text has a visible range in it, fills the comp band too -- see
 * updateRole.
 */
function JobDescriptionCard({
  roleId,
  jdText,
  jdLookupNote,
}: {
  roleId: string;
  jdText: string;
  jdLookupNote: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(jdText);
  const [error, setError] = useState<string | null>(null);
  const [lookup, setLookup] = useState<JdLookupResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [looking, startLooking] = useTransition();

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await updateRole(roleId, { jdText: draft });
      if (result.error) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  // The nightly pass walks six companies a night. A role you are looking at now
  // should not wait behind two hundred you are not, and the answer arrives in
  // about the time the board takes to reply.
  const lookItUp = () => {
    setLookup(null);
    startLooking(async () => {
      setLookup(await lookUpJobDescription(roleId));
      router.refresh();
    });
  };

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-ui font-semibold text-ink">Job description</h3>
        {!editing && (
          <div className="flex items-center gap-1">
            {!jdText && (
              <Button type="button" size="sm" variant="ghost" disabled={looking} onClick={lookItUp}>
                {looking ? 'Looking…' : 'Look it up'}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(jdText);
                setEditing(true);
              }}
            >
              {jdText ? 'Edit' : 'Add description'}
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="mt-2">
          <Textarea
            autoFocus
            rows={16}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Paste the full posting here."
          />
          {error && <p className="mt-2 text-ui text-status-rejected">{error}</p>}
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={save}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : jdText ? (
        <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap font-sans text-ui leading-relaxed text-ink-muted">
          {jdText}
        </pre>
      ) : (
        <p className="mt-3 text-ui text-ink-muted">
          Nothing saved. Add the description to build the requirement map and fill in the comp
          band automatically.
        </p>
      )}

      {/* What this lookup just did. Shown instead of the stored note, which it
          has only this second replaced -- two lines saying almost the same
          thing is how a panel stops being read. */}
      {!editing && lookup && (
        <div className="mt-3 border-t border-border pt-3">
          <p className={cn('text-small', lookup.ok ? 'text-ink-muted' : 'text-ink-muted')}>
            {lookup.message}
          </p>
          {/* The ambiguous case is the one worth spending pixels on: the board
              knows which postings these are, so linking them turns "go and find
              it" into one click away from the right page. */}
          {lookup.candidates && lookup.candidates.length > 0 && (
            <ul className="mt-2 space-y-1">
              {lookup.candidates.map((candidate) => (
                <li key={`${candidate.title}-${candidate.url ?? ''}`} className="text-small">
                  {candidate.url ? (
                    <a
                      href={candidate.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-ink-muted underline underline-offset-2 hover:text-ink"
                    >
                      {candidate.title}
                    </a>
                  ) : (
                    <span className="text-ink-muted">{candidate.title}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Why the nightly board lookup did not fill this in, or which posting it
          picked when the match was on a title rather than an id. An empty panel
          on its own asks you for nothing and explains nothing. Hidden while
          editing, where the box you are typing in is the answer. */}
      {!editing && !lookup && jdLookupNote && (
        <p className="mt-3 border-t border-border pt-3 text-small text-ink-muted">
          {jdLookupNote}
        </p>
      )}
    </section>
  );
}

function Answers({ answers, applicationId, bankSize }: PanelProps) {
  const [paste, setPaste] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-border bg-surface p-4">
        <h3 className="text-ui font-semibold text-ink">Add the application questions</h3>
        <p className="mt-0.5 text-small text-ink-muted">
          Use the bookmarklet on the application page, or paste them here — one per line, or
          numbered. Both work; the paste box always works.
        </p>
        <Textarea
          rows={4}
          value={paste}
          onChange={(event) => setPaste(event.target.value)}
          className="mt-2"
          placeholder={'1. Why do you want to work here?\n2. Tell us about a time you...'}
        />
        <div className="mt-2 flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={pending || !paste.trim()}
            onClick={() =>
              startTransition(async () => {
                const result = await addQuestions(applicationId, paste);
                setMessage(result.error ?? `Added ${result.added}.`);
                if (!result.error) setPaste('');
              })
            }
          >
            Add questions
          </Button>
          {message && <span className="text-small text-ink-muted">{message}</span>}
        </div>
      </section>

      {answers.length === 0 ? (
        <p className="rounded-card border border-dashed border-border bg-surface px-4 py-10 text-center text-ui text-ink-muted">
          No questions captured for this application yet.
        </p>
      ) : (
        <div className="space-y-3">
          {answers.map((answer) => (
            <AnswerCard key={answer.id} answer={answer} bankSize={bankSize} />
          ))}
        </div>
      )}
    </div>
  );
}

function AnswerCard({
  answer,
  bankSize,
}: {
  answer: PanelProps['answers'][number];
  bankSize: number;
}) {
  const [text, setText] = useState(answer.answer || answer.canonicalAnswer || '');
  const [status, setStatus] = useState(answer.status);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // The draft lives here, beside the textarea, and never in it. It reaches the
  // answer only through Insert, and the record only through Save -- the
  // compose.ts rule: the model may prepare text, but nothing goes out over
  // your name that you did not put there.
  const [draft, setDraft] = useState<AnswerDraft | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

  const usingCanonical = !answer.answer && Boolean(answer.canonicalAnswer);

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-ui font-medium text-ink">{answer.questionText}</p>
          <p className="mt-0.5 text-micro text-ink-muted">
            {answer.questionKind}
            {answer.timesSeen > 1 && ` · asked ${answer.timesSeen} times`}
          </p>
        </div>
        {status === 'approved' && (
          <CheckCircle2 className="size-4 shrink-0 text-status-offer" strokeWidth={2} />
        )}
      </div>

      {usingCanonical && (
        <p className="mt-2 rounded bg-accent-tint px-2 py-1 text-small text-accent">
          Filled from your default answer for this question. Edit it if this one needs tailoring.
        </p>
      )}

      {/*
        The claims a saved draft could not ground, still shown after the reload.
        This is the one thing worth re-reading before you submit, so it does not
        live only in the session that generated it.
      */}
      {!draft && answer.unsupportedClaims.length > 0 && (
        <div className="mt-2 rounded bg-caution-tint px-2 py-1.5">
          <p className="text-small font-medium text-ink">
            This answer states things your bank does not carry:
          </p>
          <ul className="mt-0.5 list-disc pl-4 text-small text-ink">
            {answer.unsupportedClaims.map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
        </div>
      )}

      <Textarea
        rows={5}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="mt-2"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await saveAnswer(answer.id, text, 'draft');
              setSaved(result.error ?? 'Saved.');
              if (!result.error) setStatus('draft');
            })
          }
        >
          Save draft
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={pending || !text.trim()}
          onClick={() =>
            startTransition(async () => {
              const result = await saveAnswer(answer.id, text, 'approved');
              setSaved(result.error ?? 'Approved.');
              if (!result.error) setStatus('approved');
            })
          }
        >
          Approve
        </Button>
        {status === 'approved' && !answer.canonicalAnswer && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await promoteToCanonical(answer.questionId, text);
                setSaved(result.error ?? 'This is now your default answer for this question.');
              })
            }
          >
            Make this my default answer
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={drafting || bankSize === 0}
          title={
            bankSize === 0
              ? 'Your evidence bank is empty, so there is nothing to draft from.'
              : undefined
          }
          onClick={() => {
            setDrafting(true);
            setDraftError(null);
            startTransition(async () => {
              const result = await draftAnswerFromEvidence({ answerId: answer.id });
              setDrafting(false);
              if (result.error || !result.draft) {
                setDraftError(result.error ?? 'Nothing came back.');
                return;
              }
              setDraft(result.draft);
            });
          }}
        >
          {drafting ? 'Drafting…' : 'Draft from my evidence'}
        </Button>
        {saved && <span className="text-small text-ink-muted">{saved}</span>}
        {draftError && <span className="text-small text-status-rejected">{draftError}</span>}
      </div>

      {draft && (
        <div className="mt-3 rounded-lg border border-border bg-canvas p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-small font-medium text-ink">A draft, from your own stories</h4>
            <span className="text-micro text-ink-muted">
              Nothing is saved until you insert it and save.
            </span>
          </div>

          <p className="mt-2 whitespace-pre-wrap text-ui leading-relaxed text-ink">
            {draft.text}
          </p>

          <p className="mt-2 text-micro text-ink-muted">
            Draws on{' '}
            {draft.evidenceItemIds.length === 1
              ? 'one item'
              : `${draft.evidenceItemIds.length} items`}{' '}
            from your bank.
          </p>

          {draft.unsupportedClaims.length > 0 && (
            <div className="mt-2 rounded bg-caution-tint px-2 py-1.5">
              <p className="text-small font-medium text-ink">
                Not grounded in anything you wrote:
              </p>
              <ul className="mt-0.5 list-disc pl-4 text-small text-ink">
                {draft.unsupportedClaims.map((claim) => (
                  <li key={claim}>{claim}</li>
                ))}
              </ul>
              <p className="mt-1 text-micro text-ink-muted">
                Check each of these before it goes out, or cut it.
              </p>
            </div>
          )}

          {draft.bannedFound.length > 0 && (
            <p className="mt-2 text-small text-caution">
              Uses {draft.bannedFound.map((phrase) => `“${phrase}”`).join(', ')} — on your banned
              list.
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setText(draft.text);
                startTransition(async () => {
                  const result = await saveDraftedAnswer({
                    answerId: answer.id,
                    answer: draft.text,
                    evidenceItemIds: draft.evidenceItemIds,
                    unsupportedClaims: draft.unsupportedClaims,
                  });
                  setSaved(result.error ?? 'Inserted and saved as a draft.');
                  if (!result.error) {
                    setStatus('draft');
                    setDraft(null);
                  }
                });
              }}
            >
              Insert
            </Button>
            <button
              type="button"
              className="text-small text-ink-muted hover:text-ink"
              onClick={() => setDraft(null)}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function Interviews({
  interviews,
  applicationId,
  timezone,
  focusInterviewId,
  messages,
  companyContacts,
  seed,
  onSeedUsed,
}: PanelProps & { seed?: InterviewSeed | null; onSeedUsed?: () => void }) {
  // Mail that says an interview exists while this tab says none does. The
  // combination is always a miss -- a hand-link that recorded only the event,
  // or a thread the extractor read without finding a date -- so it is stated
  // rather than left as a blank the tab count already implied was correct.
  const interviewMail = interviews.length === 0
    ? messages.filter((message) => INTERVIEW_MAIL.has(message.classification))
    : [];

  return (
    <div className="space-y-3">
      {interviews.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface px-4 py-10 text-center text-ui text-ink-muted">
          {interviewMail.length > 0 ? (
            <>
              <p className="text-ink">
                {interviewMail.length === 1
                  ? 'An email about scheduling is linked to this pursuit, but no interview is recorded.'
                  : `${interviewMail.length} emails about scheduling are linked to this pursuit, but no interview is recorded.`}
              </p>
              <p className="mt-1">
                The mail only ever carries a booking when it arrives with a calendar invite. Add
                the round below, or from the message itself under Linked mail.
              </p>
            </>
          ) : (
            <p>
              No interviews yet. They appear here when a scheduling email arrives, or you can add
              one below.
            </p>
          )}
        </div>
      ) : (
        interviews.map((interview) => (
          <InterviewCard
            key={interview.id}
            interview={interview}
            timezone={timezone}
            companyContacts={companyContacts}
            focused={interview.id === focusInterviewId}
          />
        ))
      )}
      <AddInterview
        applicationId={applicationId}
        nextRound={interviews.length + 1}
        seed={seed}
        onSeedUsed={onSeedUsed}
      />
    </div>
  );
}

/**
 * Who is in the room, as people rather than as text.
 *
 * A calendar invite has been recording its attendees as contacts since the
 * invite parser landed; the round just never showed them. Each name is the
 * contact record, so it opens on their title, their LinkedIn and every touch
 * you have had with them — which is the whole reason for storing a person
 * rather than a string.
 */
function Interviewers({
  interview,
  companyContacts,
}: {
  interview: PanelProps['interviews'][number];
  companyContacts: PanelProps['companyContacts'];
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const named = new Set(interview.participants.map((participant) => participant.contactId));
  const available = companyContacts.filter((contact) => !named.has(contact.id));

  const add = (contactId: string) =>
    startTransition(async () => {
      const result = await addInterviewer({ interviewId: interview.id, contactId });
      setError(result.error);
      if (!result.error) setAdding(false);
    });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-small">
      <span className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
        Interviewers
      </span>

      {interview.participants.length === 0 && !adding && (
        <span className="text-ink-muted">Nobody named yet</span>
      )}

      {interview.participants.map((participant) => (
        <span
          key={participant.contactId}
          className="inline-flex items-center gap-1 rounded-full bg-canvas px-2 py-0.5"
        >
          <Link
            href={`/jobs/contacts/${participant.contactId}`}
            className="text-ink underline underline-offset-2 hover:text-accent"
            title={participant.title ?? undefined}
          >
            {participant.name}
          </Link>
          {participant.role !== 'interviewer' && (
            <span className="text-ink-muted">{participant.role}</span>
          )}
          <button
            type="button"
            disabled={pending}
            aria-label={`Remove ${participant.name}`}
            onClick={() =>
              startTransition(() =>
                void removeInterviewer({
                  interviewId: interview.id,
                  contactId: participant.contactId,
                }),
              )
            }
            className="text-ink-muted hover:text-status-rejected"
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        available.length > 0 ? (
          <Select
            aria-label="Add an interviewer"
            defaultValue=""
            disabled={pending}
            className="h-7 w-56 py-0 text-small"
            onChange={(event) => event.target.value && add(event.target.value)}
          >
            <option value="">Pick a contact…</option>
            {available.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.title ? `${contact.name} — ${contact.title}` : contact.name}
              </option>
            ))}
          </Select>
        ) : (
          // No picker without anyone to pick: an interviewer has to exist as a
          // contact first, and inventing one from here would put a person on
          // the company with nothing but a name.
          <span className="text-ink-muted">
            No contacts at this company yet — add them on the company page first.
          </span>
        )
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="text-ink-muted underline underline-offset-2 hover:text-accent"
        >
          Add
        </button>
      )}

      {error && <span className="text-status-rejected">{error}</span>}
    </div>
  );
}

/**
 * What the round is called, and the way to correct it.
 *
 * The round number and kind are inferred from mail — a "quick chat" invite
 * becomes a recruiter screen, a second thread about one conversation becomes
 * another round. Close enough to be useful, wrong often enough that a card
 * with no way to fix its own name is a dead end.
 */
function InterviewHeading({
  interviewId,
  round,
  kind,
  when,
}: {
  interviewId: string;
  round: number;
  kind: string;
  when: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draftRound, setDraftRound] = useState(String(round));
  const [draftKind, setDraftKind] = useState(kind);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-ui font-semibold text-ink">
          Round {round} · {interviewKindLabel(kind)}
          <button
            type="button"
            onClick={() => {
              setDraftRound(String(round));
              setDraftKind(kind);
              setError(null);
              setEditing(true);
            }}
            className="ml-2 align-middle text-small font-normal text-ink-muted underline underline-offset-2 hover:text-accent"
          >
            Rename
          </button>
        </h3>
        <span className="tabular text-small text-ink-muted">{when}</span>
      </header>
    );
  }

  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor={`round-${interviewId}`}>Round</Label>
          <Input
            id={`round-${interviewId}`}
            type="number"
            min={1}
            max={99}
            value={draftRound}
            onChange={(event) => setDraftRound(event.target.value)}
            className="w-20"
          />
        </div>
        <div>
          <Label htmlFor={`kind-${interviewId}`}>Kind</Label>
          <Select
            id={`kind-${interviewId}`}
            value={draftKind}
            onChange={(event) => setDraftKind(event.target.value)}
            className="w-48"
          >
            {INTERVIEW_KINDS.map((option) => (
              <option key={option} value={option}>
                {INTERVIEW_KIND_LABEL[option]}
              </option>
            ))}
          </Select>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const parsedRound = Number(draftRound);
              if (!Number.isInteger(parsedRound) || parsedRound < 1) {
                setError('Rounds start at 1.');
                return;
              }
              const result = await saveInterview(interviewId, {
                round: parsedRound,
                kind: draftKind,
              });
              if (result.error) setError(result.error);
              else setEditing(false);
            })
          }
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          Cancel
        </Button>
      </div>
      {error && <p className="text-small text-status-rejected">{error}</p>}
    </header>
  );
}

function InterviewCard({
  interview,
  timezone,
  companyContacts,
  focused = false,
}: {
  focused?: boolean;
  interview: PanelProps['interviews'][number];
  timezone: string;
  companyContacts: PanelProps['companyContacts'];
}) {
  const [prep, setPrep] = useState(interview.prepNotes);
  const [notes, setNotes] = useState(interview.notes);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const ref = useRef<HTMLElement>(null);

  /**
   * A round starts with no notes on it, because that is the truth.
   *
   * Two empty boxes headed Prep and Interview notes were shown on every round
   * whether or not anything had been written in either, so a card with nothing
   * to say still took the space of one with plenty and the section read as
   * filled in. A note appears when it exists or when you ask for it.
   */
  const [showPrep, setShowPrep] = useState(interview.prepNotes.trim() !== '');
  const [showDebrief, setShowDebrief] = useState(interview.notes.trim() !== '');
  /** The custom note being written, or null when none is. */
  const [draft, setDraft] = useState<string | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const needsDebrief = interview.debriefDue && !notes;
  const empty =
    !showPrep && !showDebrief && draft === null && interview.customNotes.length === 0;

  // Arriving from This week's "click the interview, land on its prep" link:
  // the tab is already switched to Interviews, so what is left is finding
  // the one round among several this role might have.
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focused]);

  return (
    <section
      ref={ref}
      className={cn(
        'rounded-card border border-border bg-surface p-4',
        focused && 'ring-2 ring-accent ring-offset-2 ring-offset-canvas',
      )}
    >
      <InterviewHeading
        interviewId={interview.id}
        round={interview.round}
        kind={interview.kind}
        when={formatDateTime(interview.scheduledAt, timezone)}
      />

      <Interviewers interview={interview} companyContacts={companyContacts} />

      {needsDebrief && (
        <p className="mt-2 rounded bg-caution-tint px-2 py-1.5 text-small text-ink">
          Write the debrief tonight. One written three days later is worth very little.{' '}
          {!showDebrief && (
            <button
              type="button"
              onClick={() => setShowDebrief(true)}
              className="font-medium underline underline-offset-2"
            >
              Start it
            </button>
          )}
        </p>
      )}

      {/* One notes section per round, holding whatever has actually been
          written: the prep, the debrief, and any number of loose notes. */}
      <div className="mt-3">
        <h4 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">Notes</h4>

        {empty ? (
          <p className="mt-1 text-small text-ink-muted">Nothing written for this round yet.</p>
        ) : (
          <div className="mt-1 space-y-3">
            {showPrep && (
              <CollapsibleField label="Prep" defaultOpen>
                <Textarea rows={4} value={prep} onChange={(e) => setPrep(e.target.value)} />
              </CollapsibleField>
            )}
            {showDebrief && (
              <CollapsibleField label="Interview notes" defaultOpen>
                <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </CollapsibleField>
            )}
            {interview.customNotes.map((note) => (
              <article key={note.id} className="rounded-lg bg-sunken px-3 py-2">
                <p className="whitespace-pre-wrap text-ui text-ink">{note.body}</p>
                <p className="tabular mt-1 text-micro text-ink-muted">
                  {formatDate(note.createdAt, timezone)}
                </p>
              </article>
            ))}
            {draft !== null && (
              <div>
                <Textarea
                  rows={3}
                  value={draft}
                  autoFocus
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Anything worth remembering about this round."
                />
                <div className="mt-1.5 flex items-center gap-3">
                  <Button
                    type="button"
                    size="sm"
                    disabled={pending || !draft.trim()}
                    onClick={() =>
                      startTransition(async () => {
                        const result = await addNote({
                          interviewId: interview.id,
                          body: draft,
                        });
                        setDraftError(result.error);
                        if (!result.error) setDraft(null);
                      })
                    }
                  >
                    Add note
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(null);
                      setDraftError(null);
                    }}
                    className="text-small text-ink-muted hover:text-ink"
                  >
                    Cancel
                  </button>
                  {draftError && (
                    <span className="text-small text-status-rejected">{draftError}</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Prep and the debrief are one each -- they are fields on the round,
            not a list -- so each offers itself only while it is not already
            there. A custom note has no such limit. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-micro uppercase tracking-wider text-ink-muted">Create note</span>
          {!showPrep && (
            <NoteKindButton label="Prep" onClick={() => setShowPrep(true)} />
          )}
          {!showDebrief && (
            <NoteKindButton label="Interview" onClick={() => setShowDebrief(true)} />
          )}
          {draft === null && <NoteKindButton label="Custom" onClick={() => setDraft('')} />}
        </div>
      </div>

      {interview.questionsAsked.length > 0 && (
        <div className="mt-3">
          <h4 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
            Questions they asked
          </h4>
          <ul className="mt-1 space-y-0.5 text-ui text-ink-muted">
            {interview.questionsAsked.map((question, index) => (
              <li key={index}>· {question}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        {/* Only where there is a field to save. A custom note saves itself. */}
        {(showPrep || showDebrief) && (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await saveInterview(interview.id, { prepNotes: prep, notes });
                setSaved(result.error ?? 'Saved.');
              })
            }
          >
            Save notes
          </Button>
        )}
        {saved && <span className="text-small text-ink-muted">{saved}</span>}
        <span className="ml-auto">
          {confirmingDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-small text-ink-muted">Delete this round?</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => void deleteInterview(interview.id))}
                className="press text-small font-medium text-status-rejected"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="text-small text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="text-small text-ink-muted underline underline-offset-2 hover:text-status-rejected"
            >
              Not a real round — remove it
            </button>
          )}
        </span>
      </div>
    </section>
  );
}

/** One of the kinds of note a round can be given. */
function NoteKindButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press rounded-lg border border-border px-2 py-0.5 text-small font-medium text-ink-muted hover:border-accent hover:text-accent"
    >
      + {label}
    </button>
  );
}

/** A labeled section that opens and closes, stacked rather than side by side. */
function CollapsibleField({
  label,
  defaultOpen = false,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 text-left text-micro font-semibold uppercase tracking-wider text-ink-muted"
      >
        <ChevronDown
          className={cn('size-3.5 shrink-0 transition-transform duration-150', !open && '-rotate-90')}
          strokeWidth={1.75}
          aria-hidden
        />
        {label}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  );
}

/**
 * The other half of "I don't know why it says 2 separate rounds": the inbox
 * sometimes reads one scheduling back-and-forth as two, and the fix used to
 * require filing a bug. Now it's the button above. This is its mirror --
 * adding a round the inbox never saw at all, a phone screen nobody emailed
 * about.
 */
function AddInterview({
  applicationId,
  nextRound,
  seed,
  onSeedUsed,
}: {
  applicationId: string;
  nextRound: number;
  /** Set when the round is being added from a specific email. */
  seed?: InterviewSeed | null;
  onSeedUsed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('recruiter_screen');
  const [scheduledAt, setScheduledAt] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [usedSeed, setUsedSeed] = useState<InterviewSeed | null>(null);

  // Arriving from a message in Linked mail: open already filled in. The time
  // is deliberately not guessed from the mail -- the mail's arrival is not the
  // appointment, and a wrong hour on the board is worse than an empty field.
  if (seed && seed !== usedSeed) {
    setUsedSeed(seed);
    setKind(seed.kind);
    setError(null);
    setOpen(true);
  }

  const close = () => {
    setOpen(false);
    setUsedSeed(null);
    onSeedUsed?.();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press w-full rounded-card border border-dashed border-border bg-surface py-2.5 text-center text-ui text-ink-muted hover:border-accent hover:text-accent"
      >
        Add a round
      </button>
    );
  }

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      {usedSeed && (
        <p className="mb-3 text-small text-ink-muted">
          From{' '}
          <span className="text-ink">{usedSeed.fromSubject ?? 'the linked message'}</span> — that
          mail says when it is; put the time in below.
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="interview-kind">Kind</Label>
          <Select
            id="interview-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="w-48"
          >
            {INTERVIEW_KINDS.map((option) => (
              <option key={option} value={option}>
                {INTERVIEW_KIND_LABEL[option]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="interview-when">When</Label>
          <Input
            id="interview-when"
            type="datetime-local"
            value={scheduledAt}
            onChange={(event) => setScheduledAt(event.target.value)}
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={pending || !scheduledAt}
          onClick={() =>
            startTransition(async () => {
              const result = await addInterview({
                applicationId,
                round: nextRound,
                kind,
                scheduledAt: new Date(scheduledAt).toISOString(),
              });
              if (result.error) {
                setError(result.error);
              } else {
                setScheduledAt('');
                close();
              }
            })
          }
        >
          Add round {nextRound}
        </Button>
        <button type="button" onClick={close} className="text-small text-ink-muted hover:text-ink">
          Cancel
        </button>
        {error && <span className="text-small text-status-rejected">{error}</span>}
      </div>
    </section>
  );
}

function Notes({ notes, roleId, timezone }: PanelProps) {
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <section className="rounded-card border border-border bg-surface p-4">
        <Textarea
          rows={3}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Anything worth remembering about this role."
        />
        <div className="mt-2 flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            disabled={pending || !body.trim()}
            onClick={() =>
              startTransition(async () => {
                const result = await addNote({ roleId, body });
                setError(result.error);
                if (!result.error) setBody('');
              })
            }
          >
            Add note
          </Button>
          {error && <span className="text-small text-status-rejected">{error}</span>}
        </div>
      </section>

      {notes.map((note) => (
        <article key={note.id} className="rounded-card border border-border bg-surface p-4">
          <p className="whitespace-pre-wrap text-ui text-ink">{note.body}</p>
          <p className="tabular mt-1.5 text-micro text-ink-muted">
            {formatDate(note.createdAt, timezone)}
          </p>
        </article>
      ))}
    </div>
  );
}

function LinkedMail(props: PanelProps & { onAddInterview: (seed: InterviewSeed) => void }) {
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
        <p className="rounded-card border border-dashed border-border bg-surface px-4 py-10 text-center text-ui text-ink-muted">
          No mail has been linked to this pursuit yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-ui">
            <thead>
              <tr className="border-b border-border text-left text-micro uppercase tracking-wider text-ink-muted">
                <th className="px-2 py-2 font-semibold">Received</th>
                <th className="px-2 py-2 font-semibold">Subject</th>
                <th className="px-2 py-2 font-semibold">Kind</th>
                <th className="px-2 py-2 font-semibold">Linked by</th>
                <th className="px-2 py-2 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {messages.map((message) => (
                <tr key={message.id} className="border-b border-border">
                  <td className="tabular px-2 py-1.5 text-ink-muted">
                    {formatDate(message.receivedAt, timezone)}
                  </td>
                  <td className="px-2 py-1.5 text-ink">
                    {message.gmailHref ? (
                      <GmailLink href={message.gmailHref}>
                        {message.subject ?? '(no subject)'}
                      </GmailLink>
                    ) : (
                      (message.subject ?? '—')
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-ink-muted">
                    {message.classification.replace(/_/g, ' ')}
                  </td>
                  <td className="tabular px-2 py-1.5 text-ink-muted">
                    {message.linkMethod?.replace(/_/g, ' ') ?? '—'}
                    {message.linkConfidence !== null &&
                      ` (${Math.round(message.linkConfidence * 100)}%)`}
                  </td>
                  <td className="px-2 py-1.5 text-right">
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
                          className="whitespace-nowrap text-small text-ink-muted underline underline-offset-2 hover:text-accent"
                        >
                          Add interview
                        </button>
                      )}
                      <UnlinkMessage messageId={message.id} applicationId={applicationId} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-micro text-ink-muted">
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
function UnlinkMessage({
  messageId,
  applicationId,
}: {
  messageId: string;
  applicationId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-micro text-status-rejected">{error}</span>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              'Unlink this email? It goes back to the review queue, and anything it added to this timeline is removed.',
            )
          ) {
            return;
          }
          startTransition(async () => {
            const result = await unlinkMessage(messageId, applicationId);
            setError(result.error);
          });
        }}
        className="whitespace-nowrap text-small text-ink-muted underline underline-offset-2 hover:text-status-rejected disabled:opacity-50"
      >
        {pending ? 'Unlinking…' : 'Unlink'}
      </button>
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

  function decide(id: string, action: (messageId: string, applicationId: string) => Promise<{ error: string | null }>) {
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
        <details className="rounded-card border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-ui font-medium text-ink">
            Possible matches — {visible.length}
          </summary>
          <div className="space-y-2 border-t border-border p-3">
            <p className="text-micro text-ink-muted">
              Unlinked mail mentioning {companyName}. Approve what belongs here, or say it is not a
              match and it will not be suggested again for this pursuit.
            </p>
            <ul className="space-y-1.5">
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
        </details>
      )}

      {error && <p className="text-small text-status-rejected">{error}</p>}

      {searching ? (
        <AddOtherSearch applicationId={applicationId} timezone={timezone} onClose={() => setSearching(false)} />
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
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-canvas px-2.5 py-2 text-ui">
      <span className="tabular w-full text-micro text-ink-muted sm:w-32">
        {formatDate(message.receivedAt, timezone)}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink">
        {message.gmailHref ? (
          <GmailLink href={message.gmailHref}>{message.subject ?? '(no subject)'}</GmailLink>
        ) : (
          (message.subject ?? '—')
        )}
      </span>
      <span className="truncate text-micro text-ink-muted">{message.fromAddress ?? ''}</span>
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
        <button
          type="button"
          disabled={busy}
          onClick={onLink}
          className="press rounded-lg border border-border bg-surface px-2 py-0.5 text-small font-medium text-ink disabled:opacity-50"
        >
          Link
        </button>
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
      const { results: found, error: searchError } = await searchUnlinkedMessages(applicationId, term);
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
    <div className="rounded-card border border-dashed border-border bg-surface p-3">
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
        <Button type="button" size="sm" disabled={pending || term.trim().length < 2} onClick={search}>
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
      {error && <p className="mt-2 text-small text-status-rejected">{error}</p>}
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
