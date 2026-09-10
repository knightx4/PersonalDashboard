'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileText,
  ChevronDown,
  ListChecks,
  Mail,
  Maximize2,
  MessageSquareText,
  Pencil,
  StickyNote,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card, CardSection, cardVariants } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Field, FieldError, FieldHint, Textarea } from '@/components/ui/field';
import { AddTrigger } from '@/components/ui/add-trigger';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import {
  formatCompBand,
  formatDate,
  formatDateTime,
  formatInterviewWhen,
} from '@/lib/jobs/applications/load';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import type { Requirement } from '@/lib/jobs/jd/requirements';
import type { MatchVerdict, RequirementMatch } from '@/lib/jobs/evidence/match-payload';
import type { AnswerDraft } from '@/lib/jobs/evidence/draft-payload';
import type { PrepNote } from '@/lib/jobs/interview/prep-payload';
import { RoundPrep } from './prep-note';
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
  addInterviewerByName,
  addNote,
  addReminder,
  createInterviewRound,
  declineCandidateMessage,
  deleteInterview,
  deleteInterviewRound,
  groupInterviews,
  linkCandidateMessage,
  linkReminderMessage,
  linkRoundMessage,
  matchRoleRequirements,
  removeInterviewer,
  saveInterview,
  saveInterviewGroup,
  searchUnlinkedMessages,
  shareCasePage,
  ungroupInterview,
  unlinkMessage,
  unlinkRoundMessage,
  unshareCasePage,
  updateNote,
  updateReminder,
} from './actions';
import { dismissPursuit } from '@/app/jobs/(app)/pipeline/actions';
import {
  INTERVIEW_KIND_LABEL,
  INTERVIEW_KINDS,
  interviewKindLabel,
} from '@/lib/jobs/interview-kinds';
import { groupableDays, sectionInterviews } from '@/lib/jobs/interview-groups';
import { ReminderActions } from '@/app/jobs/(app)/today/reminder-actions';
import { ChipInput, ComposeTitle, InlineInput, Input, Label, Select } from '@/components/ui/field';

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
    kind: string;
    scheduledAt: string | null;
    /** False when only the day is settled: the hour is not to be shown. */
    timeKnown: boolean;
    /** Computed on the server: reading the clock during render is unstable. */
    debriefDue: boolean;
    format: string | null;
    status: string;
    prepNotes: string;
    notes: string;
    /** Free-form notes written against this round, newest first. */
    customNotes: Array<{ id: string; body: string; createdAt: string }>;
    /** The round it is in. Every interview is in one. */
    groupId: string | null;
    questionsAsked: string[];
    /**
     * The generated prep note, which belongs to the round rather than to this
     * conversation: only the round's lead conversation carries one, and a
     * superday reads that one note rather than four.
     */
    prepNote: PrepNote | null;
    prepNoteAt: string | null;
    /** The facts it was written against have changed since. */
    prepNoteStale: boolean;
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
  /** The rounds of the process. Every interview is inside one of these. */
  interviewGroups: Array<{
    id: string;
    label: string | null;
    /** Which round of the process this is. Null until it is given one. */
    roundNumber: number | null;
    notes: string;
    /** The linked mail this round is about — the invite, the reschedule. */
    messageIds: string[];
  }>;
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

/**
 * The picker's escape hatch, as a value no contact id can collide with.
 *
 * Contact ids are uuids, so a word is safe; it is named rather than inlined
 * because the option and the branch that reads it are far enough apart to
 * drift.
 */
const NEW_CONTACT = 'new-contact';

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
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border max-lg:scroll-fade-x">
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
              <entry.icon className="size-4" strokeWidth={1.75} aria-hidden />
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
        <Interviews {...props} seed={interviewSeed} onSeedUsed={() => setInterviewSeed(null)} />
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
  const router = useRouter();

  return (
    <div className="mt-8 border-t border-border pt-4">
      {/* A sentence, because the button on its own was a grey line floating
       * under the page with nothing to say when it applied. "Remove it" is
       * unanswerable without knowing what *it* is -- and the confirm's own
       * prompt, which does explain, only appears after you have pressed the
       * thing you were unsure about. */}
      <p className="text-small text-ink-muted">
        An advert the scan mistook for a confirmation, or a role you never went for.
      </p>
      <ConfirmStep
        className="mt-1"
        align="start"
        prompt="Remove this pursuit? The role goes with it, and the company too if nothing else is attached to it. Any mail that created it is marked not relevant, so the next sync will not bring it back."
        confirmLabel="Yes, remove it"
        pendingLabel="Removing…"
        onConfirm={async () => {
          const result = await dismissPursuit(applicationId);
          // Thrown rather than stored: ConfirmStep renders the error in place.
          if (result.error) throw new Error(result.error);
          router.push('/jobs/pipeline');
        }}
      >
        This was not a real pursuit — remove it
      </ConfirmStep>
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
      className="inline-flex items-baseline gap-1 underline decoration-border underline-offset-2 transition-colors duration-150 hover:text-accent hover:decoration-accent"
    >
      <span>{children}</span>
      <ExternalLink
        className="size-3.5 shrink-0 self-center text-ink-muted"
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="sr-only">Open in Gmail</span>
    </a>
  );
}

function Timeline({ events, timezone, otherAttempts, todos, applicationId, messages }: PanelProps) {
  return (
    <div className="space-y-4">
      <Todos todos={todos} applicationId={applicationId} timezone={timezone} messages={messages} />

      {otherAttempts.length > 0 && (
        <CardSection
          title="Earlier attempts"
          hint="Kept as history rather than overwritten — which is the whole reason a pursuit is a separate row from the posting."
        >
          <ul className="space-y-1.5">
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
        </CardSection>
      )}

      {events.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Nothing has happened yet"
          description="Events appear here as mail arrives, or when you move the card."
          action={{ label: 'Open the board', href: '/jobs/pipeline' }}
        />
      ) : (
        // One card of rows rather than a card per event: the tint on a row
        // that needs review is enough to single it out without its own border.
        <ol className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
          {events.map((event) => (
            <li
              key={event.id}
              className={cn(
                'card-pad-x row-pad flex gap-3',
                event.needsReview && 'bg-caution-tint',
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
                <p className="text-small text-ink-muted">
                  {event.kind.replace(/_/g, ' ')} · {event.source}
                </p>
                {event.needsReview && (
                  <p className="mt-1 flex items-start gap-1.5 text-small text-ink">
                    <CircleAlert
                      className="mt-0.5 size-3.5 shrink-0 text-caution"
                      strokeWidth={1.75}
                      aria-hidden
                    />
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
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <CardSection title="To-dos">
      {todos.length > 0 && (
        <ul className="mb-3 space-y-2">
          {todos.map((todo) => (
            <li key={todo.id} className="text-ui">
              <TodoLine todo={todo} messages={messages} timezone={timezone} />
            </li>
          ))}
        </ul>
      )}
      {/*
       * Not a form until there is something to add.
       *
       * This has been narrowed twice already -- from two labelled Fields and a
       * button down to one row -- and it was still a row of bordered controls
       * standing open under the list on every visit. The worst of them was the
       * date: a full-height box printing "dd/mm/yyyy" in ghost text, as wide
       * as a sentence, permanently empty. The section is the to-dos; a form
       * for adding one is not what you came to read (law 14).
       *
       * Open, it is a compose surface rather than a row of fields: the
       * sentence is the only thing set at full size, and the day is a chip
       * beside it carrying its own glyph in place of a caption (law 9).
       *
       * It is a real `<form>`, which is what makes Return submit it -- the
       * thing you actually do after typing a to-do.
       */}
      {adding ? (
        <form
          className="sheet flex flex-wrap items-center gap-2 rounded-card px-2.5 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!body.trim() || !dueAt) return;
            startTransition(async () => {
              const result = await addReminder({ applicationId, body, dueAt });
              setError(result.error);
              if (!result.error) {
                setBody('');
                setDueAt('');
                setAdding(false);
              }
            });
          }}
        >
          <ComposeTitle
            autoFocus
            value={body}
            onChange={(event) => setBody(event.target.value)}
            aria-label="The to-do"
            placeholder="What has to happen?"
            className="min-w-48 flex-1"
          />
          <ChipInput
            type="date"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            aria-label="Done by"
            icon={<CalendarClock className="size-3.5" strokeWidth={1.75} />}
          />
          <Button type="submit" size="sm" pending={pending} disabled={!body.trim() || !dueAt}>
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setBody('');
              setDueAt('');
              setError(null);
              setAdding(false);
            }}
          >
            Cancel
          </Button>
          {error && <span className="text-small text-danger">{error}</span>}
        </form>
      ) : (
        <AddTrigger label="Add a to-do" onClick={() => setAdding(true)} />
      )}
    </CardSection>
  );
}

/**
 * The date a `type="date"` input wants, from the timestamp we stored.
 *
 * Read back in UTC because that is how it was written -- `addReminder` turns
 * the picked day into midnight UTC -- so a to-do that is not edited comes back
 * out of the picker as the day that went in.
 */
function dueDateInput(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * One to-do, and the way to correct it.
 *
 * The wording of a to-do is a first guess typed while reading the mail that
 * prompted it, and the date is usually a guess as well. Without this the only
 * way to fix either was to finish it and write a new one, which throws away
 * the mail it was linked to -- so "rename it" quietly cost more than it looks
 * like it should.
 */
function TodoLine({
  todo,
  messages,
  timezone,
}: {
  todo: PanelProps['todos'][number];
  messages: PanelProps['messages'];
  timezone: string;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(todo.body);
  const [dueAt, setDueAt] = useState(() => dueDateInput(todo.dueAt));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open() {
    // From the row as it stands, not from whatever was typed and abandoned
    // the last time this was opened.
    setBody(todo.body);
    setDueAt(dueDateInput(todo.dueAt));
    setError(null);
    setEditing(true);
  }

  if (!editing) {
    return (
      /* The to-do first, its date after it, the two answers at the end.
       *
       * It used to be a date column, then the words, then Edit, then Later,
       * then Done, then "Link an email" underneath -- three lines for one
       * to-do at 390px, because `ReminderActions` pushes itself right with
       * `ml-auto` and a fixed-width date column had already spent a third of
       * the row. The date is metadata about the sentence, not a column heading
       * for it, so it reads small and after it, the way every other date in
       * this module does.
       *
       * Below `sm` the sentence keeps the whole line and the buttons take the
       * next one. Sharing a line with them only meant the to-do broke across
       * two lines around them, which is a worse two lines than these. */
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="min-w-0 basis-full text-ink sm:basis-auto sm:flex-1">
          {todo.body}
          <span className="tabular ml-2 text-small text-ink-muted">
            {formatDate(todo.dueAt, timezone)}
          </span>
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={open}>
            Edit
          </Button>
          <ReminderActions id={todo.id} />
        </span>
        <TodoMail todo={todo} messages={messages} timezone={timezone} offer={false} />
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-48 flex-1">
        <Input value={body} onChange={(event) => setBody(event.target.value)} aria-label="To-do" />
      </div>
      <Input
        type="date"
        value={dueAt}
        onChange={(event) => setDueAt(event.target.value)}
        aria-label="Done by"
        className="w-40"
      />
      <Button
        type="button"
        size="sm"
        disabled={pending || !body.trim() || !dueAt}
        onClick={() =>
          startTransition(async () => {
            const result = await updateReminder({ reminderId: todo.id, body, dueAt });
            setError(result.error);
            if (!result.error) setEditing(false);
          })
        }
      >
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {error && <span className="text-small text-danger">{error}</span>}
      <TodoMail todo={todo} messages={messages} timezone={timezone} offer />
    </div>
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
  offer,
}: {
  todo: PanelProps['todos'][number];
  messages: PanelProps['messages'];
  timezone: string;
  /**
   * Whether to offer linking one when there is none. Off in the row: an
   * unlinked to-do was printing "Link an email" underneath itself forever,
   * which is a whole third line spent saying that nothing is there. It is
   * offered where the rest of the to-do is corrected instead -- under Edit,
   * beside the wording and the date, which is where you already are when you
   * want to attach the mail it came from.
   */
  offer: boolean;
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
      <p className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-small text-ink-muted">
        <Mail className="size-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
        {todo.message.gmailHref ? (
          <GmailLink href={todo.message.gmailHref}>
            {todo.message.subject ?? '(no subject)'}
          </GmailLink>
        ) : (
          <span>{todo.message.subject ?? 'An email no longer linked to this role'}</span>
        )}
        {/* No confirm: re-linking is one pick away, so this is reversible. */}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() => save(null)}
        >
          Unlink
        </Button>
        {error && <span className="text-danger">{error}</span>}
      </p>
    );
  }

  if (!offer || messages.length === 0) return null;

  if (!picking) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(true)}>
        Link an email
      </Button>
    );
  }

  return (
    <p className="mt-1 flex flex-wrap items-center gap-2 pl-0.5 text-small">
      <Select
        aria-label="Email this to-do is about"
        defaultValue=""
        disabled={pending}
        className="max-w-full sm:max-w-md"
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
      <Button type="button" size="sm" variant="ghost" onClick={() => setPicking(false)}>
        Cancel
      </Button>
      {error && <span className="text-danger">{error}</span>}
    </p>
  );
}

/**
 * Colour carries the verdict, so a map is readable at a glance without reading
 * every line. Gap is red on purpose: it is the answer that saves you the hour,
 * not a failure state to be softened.
 *
 * The good/middling/bad triad, not the pipeline's stage hues -- which resolve
 * to the same three values in every theme, and which law 4 gives to one stage
 * each and to nothing else. A requirement is not a stage. Every line also
 * carries a dot and a word, so the colour is what makes the gaps findable
 * rather than what says which line is which.
 */
const VERDICT_STYLE: Record<MatchVerdict, { dot: string; label: string; text: string }> = {
  strong: { dot: 'bg-positive', label: 'Strong', text: 'text-positive' },
  partial: { dot: 'bg-caution-fill', label: 'Partial', text: 'text-caution' },
  gap: { dot: 'bg-danger', label: 'Gap', text: 'text-danger' },
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
      <CardSection
        title="Requirement map"
        hint={
          matches
            ? 'Your best evidence beside each line. A gap is the useful answer — it is the hour you do not spend.'
            : 'Extracted once from the description. Match it against your bank to see which lines you can actually claim.'
        }
        action={
          requirements.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              pending={matching}
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
          )
        }
      >
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
            <Link
              href="/jobs/settings"
              className="underline underline-offset-2 transition-colors duration-150 hover:text-ink"
            >
              Fill it in Settings.
            </Link>
          </p>
        )}
        <FieldError>{matchError}</FieldError>

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
      </CardSection>

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
    <CardSection
      title="Share the map"
      hint="A private link showing this role’s requirements with your evidence beside each one. It is a work sample and a cover letter in one. Gaps are never on it, and the link expires."
    >
      <Field id={`case-body-${applicationId}`} label="Why you want it" className="mt-3">
        <Textarea
          rows={4}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="A short paragraph, in your words. Nothing writes this for you."
        />
      </Field>

      {url && (
        <div className="mt-3 rounded-lg bg-canvas p-2">
          <p className="break-all font-mono text-small text-ink">{url}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                navigator.clipboard.writeText(url);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            {liveExpiry && (
              <span className="text-small text-ink-muted">
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
          title={
            canShare ? undefined : 'Match the requirements first — there is nothing to show yet.'
          }
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
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
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
          </Button>
        )}

        {error && <span className="text-small text-danger">{error}</span>}
      </div>

      {liveSlug && (
        <FieldHint>
          Re-issuing gives a new link and breaks the old one, which is how you take a shared page
          back.
        </FieldHint>
      )}
    </CardSection>
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
      <CardSection
        title="Details"
        action={
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Edit posting details"
            className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
          >
            <Pencil className="size-4" strokeWidth={1.75} aria-hidden />
            <span className="sr-only">Edit posting details</span>
          </button>
        }
      >
        <dl className="space-y-1.5 text-ui">
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 text-ink-muted">Posting link</dt>
            <dd className="min-w-0 flex-1 truncate">
              {jdUrl ? (
                <a
                  href={jdUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent underline underline-offset-2 transition-colors duration-150 hover:text-accent-hover"
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
      </CardSection>
    );
  }

  return (
    <CardSection title="Details">
      <div className="space-y-2">
        <Field id={`jdurl-${roleId}`} label="Posting link">
          <Input
            type="url"
            value={jdUrlDraft}
            onChange={(event) => setJdUrlDraft(event.target.value)}
            placeholder="https://…"
          />
        </Field>
        <Field id={`ats-${roleId}`} label="ATS job id">
          <Input value={atsJobIdDraft} onChange={(event) => setAtsJobIdDraft(event.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field id={`compmin-${roleId}`} label="Comp min ($)">
            <Input
              type="number"
              value={compMinDraft}
              onChange={(event) => setCompMinDraft(event.target.value)}
            />
          </Field>
          <Field id={`compmax-${roleId}`} label="Comp max ($)">
            <Input
              type="number"
              value={compMaxDraft}
              onChange={(event) => setCompMaxDraft(event.target.value)}
            />
          </Field>
        </div>
      </div>
      <FieldError>{error}</FieldError>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" pending={pending} onClick={save}>
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
    </CardSection>
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
    <CardSection
      title="Job description"
      action={
        !editing && (
          <div className="flex items-center gap-1">
            {!jdText && (
              <Button type="button" size="sm" variant="ghost" pending={looking} onClick={lookItUp}>
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
        )
      }
    >
      {editing ? (
        <div>
          <Textarea
            autoFocus
            rows={16}
            value={draft}
            aria-label="Job description"
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Paste the full posting here."
          />
          <FieldError>{error}</FieldError>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" pending={pending} onClick={save}>
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
        <pre className="max-h-[32rem] overflow-auto whitespace-pre-wrap font-sans text-ui leading-relaxed text-ink-muted">
          {jdText}
        </pre>
      ) : (
        <p className="text-ui text-ink-muted">
          Nothing saved. Add the description to build the requirement map and fill in the comp band
          automatically.
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
                      className="text-ink-muted underline underline-offset-2 transition-colors duration-150 hover:text-ink"
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
        <p className="mt-3 border-t border-border pt-3 text-small text-ink-muted">{jdLookupNote}</p>
      )}
    </CardSection>
  );
}

function Answers({ answers, applicationId, bankSize }: PanelProps) {
  const [paste, setPaste] = useState('');
  const [pasting, setPasting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      {/* The panel is the answers. Adding questions is something you do to it
          now and then, and it used to be a four-row textarea sitting above
          them on every visit -- the first thing on a page you came to read.
          It opens when you are actually adding something (law 14).

          Not offered at all when there is nothing here yet: the empty state
          below is the invitation, and two invitations to the same thing on one
          screen is one too many. */}
      {pasting ? (
        <CardSection title="Add the application questions" hint="One per line, or numbered.">
          <Textarea
            rows={4}
            autoFocus
            value={paste}
            aria-label="Application questions"
            onChange={(event) => setPaste(event.target.value)}
            placeholder={'1. Why do you want to work here?\n2. Tell us about a time you...'}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={pending || !paste.trim()}
              onClick={() =>
                startTransition(async () => {
                  const result = await addQuestions(applicationId, paste);
                  setMessage(result.error ?? `Added ${result.added}.`);
                  if (!result.error) {
                    setPaste('');
                    setPasting(false);
                  }
                })
              }
            >
              Add questions
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setPaste('');
                setPasting(false);
              }}
            >
              Cancel
            </Button>
            {message && <span className="text-small text-ink-muted">{message}</span>}
          </div>
        </CardSection>
      ) : (
        answers.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <AddTrigger label="Add more questions" onClick={() => setPasting(true)} />
            {message && <span className="text-small text-ink-muted">{message}</span>}
          </div>
        )
      )}

      {answers.length === 0 ? (
        // The paste box above is the action that fills this; the link goes to
        // the bookmarklet, which is the other way in. The paste box is no
        // longer standing open above this, so the empty state has to offer it:
        // law 15 puts the teaching here, which is where somebody seeing this
        // panel for the first time is standing.
        !pasting && (
          <EmptyState
            icon={MessageSquareText}
            title="No questions captured yet"
            description="Paste the questions from the application, or grab them from the page itself with the bookmarklet."
            action={{ label: 'Get the bookmarklet', href: '/jobs/settings' }}
          >
            <AddTrigger label="Paste the questions" onClick={() => setPasting(true)} />
          </EmptyState>
        )
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
  const [editing, setEditing] = useState(false);
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
    <Card padding="dense">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-ui font-medium text-ink">{answer.questionText}</p>
          <p className="mt-0.5 text-small text-ink-muted">
            {answer.questionKind}
            {answer.timesSeen > 1 && ` · asked ${answer.timesSeen} times`}
          </p>
        </div>
        {/* Positive rather than the offer hue: an approved answer is a thing
            done, not a pipeline stage. */}
        {status === 'approved' && (
          <CheckCircle2
            className="size-4 shrink-0 text-positive"
            strokeWidth={1.75}
            aria-label="Approved"
          />
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

      {/* The answer, read. It was a five-row textarea holding its own value,
          open on arrival, one per question -- so a page whose job is to show
          what you have already written showed a column of editors instead, and
          the answers themselves were never once set as prose. Law 14. Editing
          is one click and happens in the same place at the same size. */}
      {editing ? (
        <Textarea
          rows={5}
          value={text}
          autoFocus
          aria-label="Your answer"
          onChange={(event) => setText(event.target.value)}
          className="mt-2"
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Edit this answer"
          className="mt-2 -mx-1.5 -my-1 block w-full rounded-card px-1.5 py-1 text-left transition-colors duration-150 hover:bg-sunken"
        >
          {text.trim() ? (
            <span className="block max-w-prose whitespace-pre-wrap text-ui leading-relaxed text-ink">
              {text}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-ui text-ink-ghost">
              <Pencil className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              Not answered yet.
            </span>
          )}
        </button>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* Save and Approve are what you do to an answer you are writing, so
            they are where the writing is. Reading it, the only offers are the
            two that make sense on a finished answer: edit it, or draft one. */}
        {editing && (
          <>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await saveAnswer(answer.id, text, 'draft');
                  setSaved(result.error ?? 'Saved.');
                  if (!result.error) {
                    setStatus('draft');
                    setEditing(false);
                  }
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
                  if (!result.error) {
                    setStatus('approved');
                    setEditing(false);
                  }
                })
              }
            >
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setText(answer.answer || answer.canonicalAnswer || '');
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </>
        )}
        {!editing && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
            {text.trim() ? 'Edit' : 'Write an answer'}
          </Button>
        )}
        {!editing && status === 'approved' && !answer.canonicalAnswer && (
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
          pending={drafting}
          disabled={bankSize === 0}
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
        {draftError && <span className="text-small text-danger">{draftError}</span>}
      </div>

      {draft && (
        // A well, not a frame. This is the one thing on the page that is not
        // yours yet -- a machine's suggestion waiting to be inserted or thrown
        // away -- and a recessed ground says that without adding a second
        // border inside the answer card. Law 11: a shared ground groups.
        <div className="mt-3 rounded-card bg-canvas p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-small font-medium text-ink">A draft, from your own stories</h4>
            <span className="text-small text-ink-muted">
              Nothing is saved until you insert it and save.
            </span>
          </div>

          <p className="mt-2 whitespace-pre-wrap text-ui leading-relaxed text-ink">{draft.text}</p>

          <p className="mt-2 text-small text-ink-muted">
            Draws on{' '}
            {draft.evidenceItemIds.length === 1
              ? 'one item'
              : `${draft.evidenceItemIds.length} items`}{' '}
            from your bank.
          </p>

          {draft.unsupportedClaims.length > 0 && (
            <div className="mt-2 rounded bg-caution-tint px-2 py-1.5">
              <p className="text-small font-medium text-ink">Not grounded in anything you wrote:</p>
              <ul className="mt-0.5 list-disc pl-4 text-small text-ink">
                {draft.unsupportedClaims.map((claim) => (
                  <li key={claim}>{claim}</li>
                ))}
              </ul>
              <p className="mt-1 text-small text-ink-muted">
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
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Discard
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Interviews({
  interviews,
  interviewGroups,
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
  const interviewMail =
    interviews.length === 0
      ? messages.filter((message) => INTERVIEW_MAIL.has(message.classification))
      : [];

  // Scheduling mail on this pursuit, offered inside a round as the other way
  // to fill it: "add from email" rather than retyping what the invite says.
  const schedulingMail = messages.filter((message) => INTERVIEW_MAIL.has(message.classification));

  // One past the highest round the pursuit has, which is what the next round
  // to be agreed almost always is. A round with no number yet counts for
  // nothing here rather than resetting the sequence.
  const nextRoundNumber =
    interviewGroups.reduce((top, group) => Math.max(top, group.roundNumber ?? 0), 0) + 1;

  return (
    <div className="space-y-3">
      {interviews.length === 0 && interviewGroups.length === 0 ? (
        <div
          className={cn(
            cardVariants(),
            'border-dashed px-4 py-10 text-center text-ui text-ink-muted',
          )}
        >
          {interviewMail.length > 0 ? (
            <>
              <p className="text-ink">
                {interviewMail.length === 1
                  ? 'An email about scheduling is linked to this pursuit, but no interview is recorded.'
                  : `${interviewMail.length} emails about scheduling are linked to this pursuit, but no interview is recorded.`}
              </p>
              <p className="mt-1">
                The mail only ever carries a booking when it arrives with a calendar invite. Add the
                round below, or from the message itself under Linked mail.
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
        <>
          {/* Rounds that sit on one day and are not yet an occasion. Offered
              rather than done for them: two screens on the same Tuesday for
              two different reasons are not a superday, and only the reader
              knows which this is. */}
          {groupableDays(interviews, timezone).map(({ day, interviewIds }) => (
            <GroupTheseRounds
              key={day}
              applicationId={applicationId}
              day={day}
              interviewIds={interviewIds}
            />
          ))}

          {sectionInterviews(interviews, interviewGroups).map((section) =>
            section.kind === 'group' ? (
              <InterviewGroupCard
                key={section.group.id}
                applicationId={applicationId}
                group={section.group}
                interviews={section.interviews}
                schedulingMail={schedulingMail}
                roleMail={messages}
                timezone={timezone}
                companyContacts={companyContacts}
                focusInterviewId={focusInterviewId}
              />
            ) : (
              <InterviewCard
                key={section.interview.id}
                interview={section.interview}
                timezone={timezone}
                companyContacts={companyContacts}
                focused={section.interview.id === focusInterviewId}
              />
            ),
          )}
        </>
      )}
      {/* Two ways in, because both happen. A round is usually agreed before
          anything in it is booked, so it is made empty and filled as the
          invitations arrive; a single conversation nobody framed as a round
          gets one made around it, because an interview is always in a round. */}
      <AddRound applicationId={applicationId} nextRound={nextRoundNumber} />
      <AddInterview
        applicationId={applicationId}
        triggerLabel="Add an interview in a round of its own"
        seed={seed}
        onSeedUsed={onSeedUsed}
      />
    </div>
  );
}

/**
 * The round itself, before anything is in it.
 *
 * "There will be a technical round, we will send times" is the state a
 * pursuit is in most often, and it had nowhere to be recorded: rounds could
 * only be made out of interviews that already existed, which meant waiting for
 * the mail before the thing everyone had already agreed to could be written
 * down.
 */
function AddRound({ applicationId, nextRound }: { applicationId: string; nextRound: number }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await createInterviewRound({
              applicationId,
              roundNumber: nextRound,
            });
            setError(result.error);
          })
        }
        // The empty slot at the end of the rounds, drawn in the card's own
        // classes with the border dashed -- the same spelling AddInterview
        // below already used for the identical affordance. It was hand-written
        // here, which is how two buttons doing one job ended up with two
        // radii and two edges.
        className={cn(
          cardVariants(),
          'press w-full border-dashed py-2.5 text-center text-ui text-ink-muted hover:border-accent hover:text-accent',
        )}
      >
        {pending ? 'Adding…' : 'Add a round'}
      </button>
      {error && <p className="mt-1 text-small text-danger">{error}</p>}
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
  /** The name being typed for somebody not on file yet, or null when none is. */
  const [newName, setNewName] = useState<string | null>(null);
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

  const addByName = () =>
    startTransition(async () => {
      const result = await addInterviewerByName({
        interviewId: interview.id,
        name: newName ?? '',
      });
      setError(result.error);
      if (!result.error) {
        setNewName(null);
        setAdding(false);
      }
    });

  /**
   * The name field, offered from inside the picker and instead of it when the
   * company has nobody on file.
   *
   * An interviewer has by definition never emailed you, so they are exactly
   * the people the contact list does not have yet -- which made "pick a
   * contact" a dead end at the moment it mattered most. The person is created
   * on this company, so the name on the round is a record with a page rather
   * than a string.
   */
  const nameField = (
    <span className="inline-flex items-center gap-1.5">
      <Input
        value={newName ?? ''}
        autoFocus
        placeholder="Their name"
        aria-label="Name of the person to add"
        className="h-7 w-48 py-0 text-small"
        onChange={(event) => setNewName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && newName?.trim()) {
            event.preventDefault();
            addByName();
          }
        }}
      />
      <Button type="button" size="sm" disabled={pending || !newName?.trim()} onClick={addByName}>
        Add
      </Button>
      <button
        type="button"
        onClick={() => {
          setNewName(null);
          setError(null);
        }}
        className="text-small text-ink-muted hover:text-ink"
      >
        Cancel
      </button>
    </span>
  );

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
              startTransition(
                () =>
                  void removeInterviewer({
                    interviewId: interview.id,
                    contactId: participant.contactId,
                  }),
              )
            }
            className="text-ink-muted hover:text-danger"
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        newName !== null || available.length === 0 ? (
          nameField
        ) : (
          <Select
            aria-label="Add an interviewer"
            defaultValue=""
            disabled={pending}
            className="h-7 w-56 py-0 text-small"
            onChange={(event) => {
              if (event.target.value === NEW_CONTACT) {
                setNewName('');
                setError(null);
                return;
              }
              if (event.target.value) add(event.target.value);
            }}
          >
            <option value="">Pick a contact…</option>
            {available.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.title ? `${contact.name} — ${contact.title}` : contact.name}
              </option>
            ))}
            <option value={NEW_CONTACT}>+ Someone new…</option>
          </Select>
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

      {error && <span className="text-danger">{error}</span>}
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
/**
 * The two form fields as the pair the server takes.
 *
 * A day with no hour is stored at local midnight with `timeKnown` false: the
 * timestamp still sorts and groups on the day it was typed for, and the flag
 * is what stops the card from claiming the interview starts at midnight.
 */
function scheduleFromFields(
  date: string,
  time: string,
): { scheduledAt: string | null; timeKnown: boolean } {
  if (!date) return { scheduledAt: null, timeKnown: false };
  const parsed = new Date(`${date}T${time || '00:00'}`);
  if (!Number.isFinite(parsed.getTime())) return { scheduledAt: null, timeKnown: false };
  return { scheduledAt: parsed.toISOString(), timeKnown: time !== '' };
}

/** The stored instant back as the two fields, in the browser's own zone. */
function fieldsFromSchedule(
  iso: string | null,
  timeKnown: boolean,
): { date: string; time: string } {
  if (!iso) return { date: '', time: '' };
  const value = new Date(iso);
  if (!Number.isFinite(value.getTime())) return { date: '', time: '' };
  const pad = (part: number) => String(part).padStart(2, '0');
  return {
    date: `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`,
    time: timeKnown ? `${pad(value.getHours())}:${pad(value.getMinutes())}` : '',
  };
}

function InterviewHeading({
  interviewId,
  kind,
  when,
  scheduledAt,
  timeKnown,
}: {
  interviewId: string;
  kind: string;
  when: string;
  scheduledAt: string | null;
  timeKnown: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draftKind, setDraftKind] = useState(kind);
  const [draftDate, setDraftDate] = useState(fieldsFromSchedule(scheduledAt, timeKnown).date);
  const [draftTime, setDraftTime] = useState(fieldsFromSchedule(scheduledAt, timeKnown).time);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!editing) {
    return (
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        {/* No round number here. The interview is one conversation inside a
            round, and the round above it is what carries the number. */}
        <h3 className="text-ui font-semibold text-ink">
          {interviewKindLabel(kind)}
          <button
            type="button"
            onClick={() => {
              setDraftKind(kind);
              const fields = fieldsFromSchedule(scheduledAt, timeKnown);
              setDraftDate(fields.date);
              setDraftTime(fields.time);
              setError(null);
              setEditing(true);
            }}
            className="ml-2 align-middle text-small font-normal text-ink-muted underline underline-offset-2 hover:text-accent"
          >
            Edit
          </button>
        </h3>
        <span className={cn('tabular text-small', scheduledAt ? 'text-ink-muted' : 'text-caution')}>
          {when}
        </span>
      </header>
    );
  }

  return (
    <header className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
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
        {/* A round can be added before anyone has said when it is, so this is
            where the date arrives once it exists — and where a day agreed
            without an hour gets its hour. */}
        <div>
          <Label htmlFor={`date-${interviewId}`}>Date</Label>
          <Input
            id={`date-${interviewId}`}
            type="date"
            value={draftDate}
            onChange={(event) => setDraftDate(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`time-${interviewId}`}>Time</Label>
          <Input
            id={`time-${interviewId}`}
            type="time"
            value={draftTime}
            disabled={!draftDate}
            onChange={(event) => setDraftTime(event.target.value)}
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await saveInterview(interviewId, {
                kind: draftKind,
                ...scheduleFromFields(draftDate, draftTime),
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
      {error && <p className="text-small text-danger">{error}</p>}
    </header>
  );
}

/**
 * The offer to read several rounds on one day as one occasion.
 *
 * A one-click action rather than a picker: the set is already known -- it is
 * every ungrouped round on that date -- and anything else can be taken back
 * out of the group afterwards.
 */
function GroupTheseRounds({
  applicationId,
  day,
  interviewIds,
}: {
  applicationId: string;
  day: string;
  interviewIds: string[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // `day` is already the date in the reader's zone, so it is formatted as
  // written rather than converted again -- which past ±12 would move it.
  const label = formatDate(`${day}T00:00:00.000Z`, 'UTC');

  return (
    <div
      className={cn(cardVariants(), 'flex flex-wrap items-center gap-3 border-dashed px-4 py-2.5')}
    >
      <p className="text-ui text-ink-muted">
        {interviewIds.length} interviews on {label}, in separate rounds.
      </p>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await groupInterviews({ applicationId, interviewIds, label });
            setError(result.error);
          })
        }
      >
        Make them one round
      </Button>
      {error && <span className="text-small text-danger">{error}</span>}
    </div>
  );
}

/**
 * A round: the interviews in it unchanged, inside something that can hold an
 * opinion about the round as a whole.
 *
 * The interviews are not flattened or merged. Each keeps its hour, its
 * interviewers and its own notes, because that is what makes the round worth
 * having rather than one long entry -- what is added is the line above them
 * and the paragraph that belongs to none of them.
 *
 * A round holds anything from nothing to a superday. It can be made empty and
 * filled as invitations arrive, from the inbox or by hand, which is how a
 * round that was agreed before it was booked gets recorded at all.
 */
function InterviewGroupCard({
  applicationId,
  group,
  interviews,
  schedulingMail,
  roleMail,
  timezone,
  companyContacts,
  focusInterviewId,
}: {
  applicationId: string;
  group: PanelProps['interviewGroups'][number];
  interviews: PanelProps['interviews'];
  /** Scheduling mail on this pursuit, as a starting point for a new one. */
  schedulingMail: PanelProps['messages'];
  /** Every email linked to this pursuit, to say which ones this round is about. */
  roleMail: PanelProps['messages'];
  timezone: string;
  companyContacts: PanelProps['companyContacts'];
  focusInterviewId?: string | null;
}) {
  const [label, setLabel] = useState(group.label ?? '');
  const [roundNumber, setRoundNumber] = useState(
    group.roundNumber === null ? '' : String(group.roundNumber),
  );
  const [notes, setNotes] = useState(group.notes);
  /** A round starts with no note on it, because that is the truth. */
  const [showNotes, setShowNotes] = useState(group.notes.trim() !== '');
  const [saved, setSaved] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  /**
   * Open, until you fold it.
   *
   * A pursuit that has been running a while carries five or six rounds, and
   * all of them expanded is a page you scroll past rather than read. Folded
   * away, the header still says which round it is, what it is called and how
   * much is in it -- which is what you are scanning for when you fold one.
   *
   * Open by default all the same: a round you have just opened the tab to look
   * at should be showing, and the one thing anybody wants closed -- an empty
   * note -- is already closed on its own account.
   */
  const [open, setOpen] = useState(true);
  const [pending, startTransition] = useTransition();

  /**
   * Which conversation of the round carries the note.
   *
   * Whichever already has one, so a note written before a conversation was
   * added stays where it was written; otherwise the earliest scheduled, which
   * is the one the action writes against. Null only for a round with nothing
   * in it yet, which has nothing to prepare from either.
   */
  const prepCarrier =
    interviews.find((interview) => interview.prepNote !== null) ??
    interviews.find((interview) => interview.scheduledAt !== null) ??
    interviews[0];

  /**
   * The round's three fields go together, because they are edited together:
   * the number and the name sit side by side in the header and the note folds
   * out under them, and one Save for all of it is what the card looks like it
   * offers.
   *
   * A blank number is a round nobody has placed yet, not a zero.
   */
  const save = () =>
    startTransition(async () => {
      const trimmed = roundNumber.trim();
      const parsed = trimmed === '' ? null : Number(trimmed);
      if (parsed !== null && (!Number.isInteger(parsed) || parsed < 1 || parsed > 99)) {
        setSaved('Rounds are numbered 1 to 99.');
        return;
      }

      const result = await saveInterviewGroup(group.id, {
        label,
        notes,
        roundNumber: parsed,
      });
      setSaved(result.error ?? 'Saved.');
    });

  return (
    // A card, in the app's card, rather than a rectangle that happened to look
    // like one. The accent edge and wash stay: a round is the one container on
    // this tab that holds other cards, and the tint is what says which
    // interviews belong to which round without indenting them.
    <Card padding="dense" className="border-accent/40 bg-accent-tint/30">
      <header className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label={open ? 'Fold this round away' : 'Open this round'}
          className="press flex size-6 shrink-0 items-center justify-center rounded text-ink-muted hover:text-accent"
        >
          <ChevronDown
            className={cn('size-4 transition-transform duration-150', !open && '-rotate-90')}
            strokeWidth={1.75}
            aria-hidden
          />
        </button>
        <CalendarClock className="size-4 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
        {/* The number is the round's, not the interviews'. Four conversations
            on one afternoon are all the second round; numbering each of them
            separately was what made a superday read as rounds 1, 3 and 4.

            It is the same heading open or folded. It used to become two
            bordered input boxes the moment the round was opened, so opening a
            round to read what was in it turned its title into a form you had
            not asked to fill in -- and a column of open rounds was a column of
            boxes (law 14).

            Open, the two parts are InlineInputs: set exactly like the heading
            they stand in for, picking up a ground on hover and a border on
            focus, so they are text until they are touched and the value and
            its editor are the same object in the same place (law 12). Folded,
            the round is something you are scanning past and nothing there is
            editable at all. */}
        <h3 className="flex min-w-0 flex-1 items-baseline gap-x-1.5 text-ui font-semibold text-ink">
          {open ? (
            <>
              <span className="text-ink-muted">Round</span>
              <InlineInput
                type="number"
                min={1}
                max={99}
                value={roundNumber}
                onChange={(event) => setRoundNumber(event.target.value)}
                aria-label="Which round of the process this is"
                placeholder="#"
                // Sized to the number rather than to a fixed box, or the
                // heading reads "Round 1      ·  First round" with a hole in
                // it where the empty half of the input is.
                className="field-sizing-content w-auto min-w-6 max-w-14 shrink-0 font-semibold"
              />
              <span className="shrink-0 text-ink-ghost">·</span>
              <InlineInput
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                aria-label="What to call this round"
                placeholder="Technical round"
                className="field-sizing-content min-w-0 max-w-56 flex-1 font-semibold"
              />
            </>
          ) : (
            <>
              {roundNumber.trim() ? `Round ${roundNumber.trim()}` : 'Unplaced round'}
              {label.trim() && ` · ${label.trim()}`}
            </>
          )}
        </h3>
        <span className="text-small text-ink-muted">
          {interviews.length === 0
            ? 'Nothing booked in yet'
            : interviews.length === 1
              ? '1 interview'
              : `${interviews.length} interviews, together`}
        </span>
        {/* Only while it is empty: a round with conversations in it is
            removed by taking those out first, so nothing is swept away by a
            click on the wrong card. */}
        {interviews.length === 0 && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (!removing) {
                setRemoving(true);
                return;
              }
              startTransition(async () => {
                const result = await deleteInterviewRound(group.id);
                if (result.error) {
                  setSaved(result.error);
                  setRemoving(false);
                }
              });
            }}
            className="ml-auto text-small text-ink-muted underline underline-offset-2 hover:text-danger"
          >
            {removing ? 'Really remove it?' : 'Remove this round'}
          </button>
        )}
      </header>

      {!open ? null : (
        <>
          {/* No note until there is one, and foldable once there is -- the same
            way a round's own notes behave one level down. A textarea shown on
            every round whether or not anything had been written in it made an
            empty round take the space of a full one and read as filled in. */}
          <div className="mt-3">
            {showNotes ? (
              <CollapsibleField label="Notes on this round" defaultOpen>
                <Textarea
                  rows={3}
                  value={notes}
                  autoFocus={notes === ''}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="How the round went as a whole. Each interview keeps its own notes below."
                />
                <div className="mt-1.5 flex items-center gap-3">
                  <Button type="button" size="sm" disabled={pending} onClick={save}>
                    Save
                  </Button>
                  {saved && <span className="text-small text-ink-muted">{saved}</span>}
                </div>
              </CollapsibleField>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <NoteKindButton label="Note on this round" onClick={() => setShowNotes(true)} />
                {/* The number and the name still need saving with nothing written
                  under them, so the button stays reachable while the note is
                  folded away. */}
                <button
                  type="button"
                  disabled={pending}
                  onClick={save}
                  className="text-small text-ink-muted underline underline-offset-2 hover:text-accent"
                >
                  Save the round
                </button>
                {saved && <span className="text-small text-ink-muted">{saved}</span>}
              </div>
            )}
          </div>

          <RoundMail groupId={group.id} messageIds={group.messageIds} roleMail={roleMail} />

          {/* One note for the occasion. It is stored on the round's earliest
            conversation, so the carrier is whichever of them has one and the
            lead otherwise -- which is where the action would write it. */}
          {prepCarrier && (
            <RoundPrep
              interviewId={prepCarrier.id}
              state={{
                note: prepCarrier.prepNote,
                generatedAt: prepCarrier.prepNoteAt,
                stale: prepCarrier.prepNoteStale,
              }}
              timezone={timezone}
            />
          )}

          <div className="mt-3 space-y-3">
            {interviews.map((interview) => (
              <InterviewCard
                key={interview.id}
                interview={interview}
                timezone={timezone}
                companyContacts={companyContacts}
                focused={interview.id === focusInterviewId}
                grouped
              />
            ))}

            {/* The round fills up from here: another conversation in the same
              round is one click, and an invitation that is already in the inbox
              starts from the message rather than from a blank form. */}
            <AddInterview
              applicationId={applicationId}
              groupId={group.id}
              mailOptions={schedulingMail}
              triggerLabel={
                interviews.length === 0 ? 'Add an interview' : 'Add another interview to this round'
              }
            />
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * The emails this round is about, addable at any point in its life.
 *
 * "Add from email" used to live only on the form that makes an interview, and
 * even there it only copied the kind across — so once a round existed there was
 * no way to say which invitation it came out of, and nothing was written down
 * when there had been. Both halves are fixed here: the list is on the round
 * itself, and each pick is a row rather than a prefilled field.
 *
 * Several are expected. The invite, the reschedule and the panel list are three
 * messages about one round, and all three are worth having on it.
 */
function RoundMail({
  groupId,
  messageIds,
  roleMail,
}: {
  groupId: string;
  messageIds: string[];
  roleMail: PanelProps['messages'];
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const attached = new Set(messageIds);
  const linked = roleMail.filter((message) => attached.has(message.id));
  const available = roleMail.filter((message) => !attached.has(message.id));

  return (
    <div className="mt-3">
      {/* The heading and the way to add one share a line, and a round with no
          mail on it says so by having nothing under that line.
          It used to be three: the heading, then "None named yet.", then "Add
          an email" -- three lines to report an absence, on a tab where a round
          with one phone screen in it already runs past the fold. */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
          Emails about this round
        </h4>
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-small text-ink-muted underline underline-offset-2 hover:text-accent"
          >
            Add an email
          </button>
        )}
      </div>

      {linked.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {linked.map((message) => (
            <li key={message.id} className="flex items-baseline gap-2 text-small">
              {message.gmailHref ? (
                <GmailLink href={message.gmailHref}>{message.subject ?? '(no subject)'}</GmailLink>
              ) : (
                <span className="text-ink">{message.subject ?? '(no subject)'}</span>
              )}
              <button
                type="button"
                disabled={pending}
                aria-label={`Take ${message.subject ?? 'this email'} off this round`}
                onClick={() =>
                  startTransition(async () => {
                    const result = await unlinkRoundMessage({ groupId, messageId: message.id });
                    setError(result.error);
                  })
                }
                className="text-ink-muted hover:text-danger"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding &&
        (available.length > 0 ? (
          <Select
            aria-label="Add an email to this round"
            defaultValue=""
            disabled={pending}
            className="mt-1.5 h-7 w-full max-w-96 py-0 text-small"
            onChange={(event) => {
              const messageId = event.target.value;
              if (!messageId) return;
              startTransition(async () => {
                const result = await linkRoundMessage({ groupId, messageId });
                setError(result.error);
                if (!result.error) setAdding(false);
              });
            }}
          >
            <option value="">Pick a linked email…</option>
            {available.map((message) => (
              <option key={message.id} value={message.id}>
                {message.subject ?? '(no subject)'}
              </option>
            ))}
          </Select>
        ) : (
          // Only mail already linked to this pursuit is offered: a round names
          // which of the role's emails it is about, it does not go fishing in
          // the mailbox. Anything missing is linked under Linked mail first.
          <p className="mt-1.5 text-small text-ink-muted">
            {roleMail.length === 0
              ? 'No mail is linked to this pursuit yet.'
              : 'Every linked email is already on this round.'}
          </p>
        ))}

      {error && <p className="mt-1 text-small text-danger">{error}</p>}
    </div>
  );
}

function InterviewCard({
  interview,
  timezone,
  companyContacts,
  focused = false,
  grouped = false,
}: {
  focused?: boolean;
  /** Rendered inside a group card, which supplies the surround. */
  grouped?: boolean;
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
  const empty = !showPrep && !showDebrief && draft === null && interview.customNotes.length === 0;

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
        cardVariants({ padding: 'dense' }),
        focused && 'ring-2 ring-accent ring-offset-2 ring-offset-canvas',
      )}
    >
      <InterviewHeading
        interviewId={interview.id}
        kind={interview.kind}
        when={formatInterviewWhen(interview.scheduledAt, interview.timeKnown, timezone)}
        scheduledAt={interview.scheduledAt}
        timeKnown={interview.timeKnown}
      />

      <Interviewers interview={interview} companyContacts={companyContacts} />

      {/* A round of one conversation carries its own note. Inside a group the
          round card holds it instead, so a superday reads one note about the
          day rather than four about its quarters. */}
      {!grouped && (
        <RoundPrep
          interviewId={interview.id}
          state={{
            note: interview.prepNote,
            generatedAt: interview.prepNoteAt,
            stale: interview.prepNoteStale,
          }}
          timezone={timezone}
        />
      )}

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
                <p className="tabular mt-1 text-small text-ink-muted">
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
                  {draftError && <span className="text-small text-danger">{draftError}</span>}
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
          {!showPrep && <NoteKindButton label="Prep" onClick={() => setShowPrep(true)} />}
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

      {/* Wrapping, because at 390px this row does not fit and without it the
          links broke mid-phrase instead: "Move it to its own / round" and "Not
          a real round — remove / it", each centred over two lines. A row that
          wraps puts each of them on a line whole. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
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
        {grouped && (
          <button
            type="button"
            disabled={pending}
            onClick={() => startTransition(() => void ungroupInterview(interview.id))}
            className="text-small text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            Move it to its own round
          </button>
        )}
        <span className="ml-auto">
          {confirmingDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-small text-ink-muted">Delete this round?</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => void deleteInterview(interview.id))}
                className="press text-small font-medium text-danger"
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
              className="text-small text-ink-muted underline underline-offset-2 hover:text-danger"
            >
              Not a real round — remove it
            </button>
          )}
        </span>
      </div>
    </section>
  );
}

/**
 * One of the kinds of note a round can be given.
 *
 * A button, so it is drawn as one. It used to spell its own box -- a container
 * hairline around a control, at a height nothing else on the row shared -- and
 * three of them in a line read as three little cards rather than as a choice.
 */
function NoteKindButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="secondary" size="sm" onClick={onClick}>
      + {label}
    </Button>
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
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-150',
            !open && '-rotate-90',
          )}
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
  groupId = null,
  mailOptions = [],
  triggerLabel = 'Add an interview',
  seed,
  onSeedUsed,
}: {
  applicationId: string;
  /** The round this goes in. Null means a new round holding just this one. */
  groupId?: string | null;
  /** Scheduling mail on this pursuit, offered as a starting point. */
  mailOptions?: PanelProps['messages'];
  triggerLabel?: string;
  /** Set when the round is being added from a specific email. */
  seed?: InterviewSeed | null;
  onSeedUsed?: () => void;
}) {
  const fieldId = useId();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('recruiter_screen');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [usedSeed, setUsedSeed] = useState<InterviewSeed | null>(null);
  /** A message picked from the list below, as opposed to one passed in. */
  const [fromMail, setFromMail] = useState<InterviewSeed | null>(null);
  const startedFrom = usedSeed ?? fromMail;

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
    setFromMail(null);
    onSeedUsed?.();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          cardVariants(),
          'press w-full border-dashed py-2.5 text-center text-ui text-ink-muted hover:border-accent hover:text-accent',
        )}
      >
        {triggerLabel}
      </button>
    );
  }

  return (
    <section className={cardVariants({ padding: 'dense' })}>
      {startedFrom ? (
        <p className="mb-3 text-small text-ink-muted">
          From <span className="text-ink">{startedFrom.fromSubject ?? 'the linked message'}</span> —
          that mail says when it is; put the time in below.
        </p>
      ) : (
        // Add from email, in the round rather than off in the mail tab: the
        // subject is the whole reason you remember which conversation this is.
        //
        // A dropdown rather than the subjects laid out in a row. Subject lines
        // are long and there are as many of them as the pursuit has scheduling
        // mail, so spread out they wrapped over several lines and pushed the
        // form itself out of sight -- and read as a paragraph of links rather
        // than as a list of one thing to choose.
        mailOptions.length > 0 && (
          <div className="mb-3">
            <Label htmlFor={`${fieldId}-mail`}>Add from email</Label>
            <Select
              id={`${fieldId}-mail`}
              defaultValue=""
              className="w-full max-w-96"
              onChange={(event) => {
                const message = mailOptions.find((option) => option.id === event.target.value);
                if (!message) return;
                setFromMail({ kind: 'recruiter_screen', fromSubject: message.subject });
                setError(null);
              }}
            >
              <option value="">Start from a scheduling email…</option>
              {mailOptions.map((message) => (
                <option key={message.id} value={message.id}>
                  {message.subject ?? '(no subject)'}
                </option>
              ))}
            </Select>
          </div>
        )
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor={`${fieldId}-kind`}>Kind</Label>
          <Select
            id={`${fieldId}-kind`}
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
        {/* Date and time as two fields rather than one datetime-local,
            because the second is often not settled when the first is: an
            onsite is agreed for the 15th days before anyone says at what
            hour, and both empty is its own real answer — "they said yes,
            dates to follow". The hour can be filled in from the heading
            later. */}
        <div>
          <Label htmlFor={`${fieldId}-date`}>Date</Label>
          <Input
            id={`${fieldId}-date`}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <div>
          <Label htmlFor={`${fieldId}-time`}>Time</Label>
          <Input
            id={`${fieldId}-time`}
            type="time"
            value={time}
            disabled={!date}
            onChange={(event) => setTime(event.target.value)}
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await addInterview({
                applicationId,
                kind,
                groupId,
                ...scheduleFromFields(date, time),
              });
              if (result.error) {
                setError(result.error);
              } else {
                setDate('');
                setTime('');
                close();
              }
            })
          }
        >
          {groupId ? 'Add it to this round' : 'Add it in a round of its own'}
        </Button>
        <button type="button" onClick={close} className="text-small text-ink-muted hover:text-ink">
          Cancel
        </button>
        {error && <span className="text-small text-danger">{error}</span>}
      </div>
    </section>
  );
}

function Notes({ notes, roleId, timezone }: PanelProps) {
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);

  const open = notes.find((note) => note.id === opened) ?? null;

  return (
    <div className="space-y-3">
      <section className={cardVariants({ padding: 'dense' })}>
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
          {error && <span className="text-small text-danger">{error}</span>}
        </div>
      </section>

      {notes.map((note) => (
        <article key={note.id} className={cn(cardVariants({ padding: 'dense' }), 'group relative')}>
          {/* A note longer than a couple of lines is a document, and this list
              is not where a document is read or written. The card stays the
              list's summary of it; the window is the note itself. */}
          <button
            type="button"
            title="Open the note"
            onClick={() => setOpened(note.id)}
            className="press absolute right-2 top-2 flex size-7 items-center justify-center rounded-lg text-ink-muted opacity-100 transition-opacity duration-150 hover:bg-sunken hover:text-ink sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
          >
            <Maximize2 className="size-3.5" strokeWidth={1.75} aria-hidden />
            <span className="sr-only">Open the note</span>
          </button>
          <p className="whitespace-pre-wrap pr-8 text-ui text-ink">{note.body}</p>
          <p className="tabular mt-1.5 text-small text-ink-muted">
            {formatDate(note.createdAt, timezone)}
          </p>
        </article>
      ))}

      {open && (
        <NoteWindow
          key={open.id}
          note={open}
          roleId={roleId}
          timezone={timezone}
          onClose={() => setOpened(null)}
        />
      )}
    </div>
  );
}

/**
 * One note, with the page out of the way.
 *
 * A note that is worth writing at length was being written into a three-line
 * box on a tab beside five other tabs, and read back as a paragraph squeezed
 * into a card. This is the same note with nothing else on the screen: one
 * column at reading width, the text at reading size, and a bar at the top that
 * says when it was written and whether it is saved.
 *
 * It saves on the way out as well as on demand -- closing an editor is not a
 * decision to discard what is in it, and being asked "save?" for something you
 * plainly meant to keep is the failure this avoids.
 */
function NoteWindow({
  note,
  roleId,
  timezone,
  onClose,
}: {
  note: { id: string; body: string; createdAt: string };
  roleId: string;
  timezone: string;
  onClose: () => void;
}) {
  const [body, setBody] = useState(note.body);
  const [state, setState] = useState<'clean' | 'dirty' | 'saving' | 'saved'>('clean');
  const [error, setError] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [, startTransition] = useTransition();

  const dirty = body.trim() !== note.body.trim();

  const save = useCallback(
    (then?: () => void) => {
      // Nothing to write is not a failure to write: closing an untouched note
      // just closes it.
      if (!dirty || !body.trim()) {
        then?.();
        return;
      }
      setState('saving');
      startTransition(async () => {
        const result = await updateNote({ noteId: note.id, roleId, body });
        setError(result.error);
        setState(result.error ? 'dirty' : 'saved');
        if (!result.error) then?.();
      });
    },
    [body, dirty, note.id, roleId],
  );

  useEffect(() => {
    const area = areaRef.current;
    if (area) {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        save(onClose);
      } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        save();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, save]);

  // Read off what is actually true rather than off the last thing that
  // happened: typing a word and deleting it again leaves nothing to save.
  const status =
    error !== null
      ? null
      : state === 'saving'
        ? 'Saving…'
        : dirty
          ? 'Unsaved'
          : state === 'saved'
            ? 'Saved'
            : null;

  return (
    <div className="fixed inset-0 z-overlay flex flex-col bg-canvas">
      <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <button
          type="button"
          onClick={() => save(onClose)}
          className="press flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-sunken hover:text-ink"
        >
          <X className="size-4" strokeWidth={2} aria-hidden />
          <span className="sr-only">Close the note</span>
        </button>
        <span className="tabular text-small text-ink-muted">
          {formatDate(note.createdAt, timezone)}
        </span>
        <span className="min-w-0 flex-1" />
        {error && <span className="text-small text-danger">{error}</span>}
        {status && <span className="text-small text-ink-muted">{status}</span>}
        <Button
          type="button"
          size="sm"
          disabled={state === 'saving' || !dirty}
          onClick={() => save()}
        >
          Save
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex h-full w-full max-w-prose px-6 py-8">
          <textarea
            ref={areaRef}
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
              setState('dirty');
            }}
            aria-label="The note"
            className="min-h-full w-full resize-none bg-transparent text-body leading-relaxed text-ink outline-none placeholder:text-ink-ghost"
            placeholder="Write."
          />
        </div>
      </div>
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
                          className="whitespace-nowrap text-small text-ink-muted underline underline-offset-2 transition-colors duration-150 hover:text-accent"
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
