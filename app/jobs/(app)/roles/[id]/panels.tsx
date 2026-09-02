'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  FileText,
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
import { addQuestions, promoteToCanonical, saveAnswer, updateRole } from '../actions';
import {
  addInterview,
  addNote,
  addReminder,
  declineCandidateMessage,
  deleteInterview,
  linkCandidateMessage,
  saveInterview,
  searchUnlinkedMessages,
} from './actions';
import { dismissPursuit } from '@/app/jobs/(app)/pipeline/actions';
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
  jdUrl: string | null;
  atsJobId: string | null;
  compMinCents: number | null;
  compMaxCents: number | null;
  compSource: string | null;
  requirements: Requirement[];
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
    questionsAsked: string[];
  }>;
  answers: Array<{
    id: string;
    answer: string;
    status: string;
    questionId: string;
    questionText: string;
    questionKind: string;
    canonicalAnswer: string | null;
    timesSeen: number;
  }>;
  notes: Array<{ id: string; body: string; pinned: boolean; createdAt: string }>;
  /** Open to-dos you set for yourself, not events the inbox produced. */
  todos: Array<{ id: string; body: string; dueAt: string }>;
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

export function RoleDetailPanels(props: PanelProps & { initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(props.initialTab ?? 'timeline');

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
                'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors duration-150',
                active
                  ? 'border-brand text-brand'
                  : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              <entry.icon className="size-3.5" strokeWidth={1.75} />
              {entry.label}
              {count !== undefined && count > 0 && (
                <span className="tabular text-ink-faint">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'timeline' && <Timeline {...props} />}
      {tab === 'posting' && <Posting {...props} />}
      {tab === 'answers' && <Answers {...props} />}
      {tab === 'interviews' && <Interviews {...props} />}
      {tab === 'notes' && <Notes {...props} />}
      {tab === 'mail' && <LinkedMail {...props} />}

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
          <p className="text-[13px] text-ink">
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
          {error && <p className="text-[13px] text-status-rejected">{error}</p>}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-[12px] text-ink-faint hover:text-status-rejected hover:underline"
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
      className="inline-flex items-baseline gap-1 underline decoration-border underline-offset-2 hover:text-brand hover:decoration-brand"
    >
      <span>{children}</span>
      <ExternalLink className="size-3 shrink-0 self-center text-ink-faint" strokeWidth={1.75} aria-hidden />
      <span className="sr-only">Open in Gmail</span>
    </a>
  );
}

function Timeline({ events, timezone, otherAttempts, todos, applicationId }: PanelProps) {
  return (
    <div className="space-y-4">
      <Todos todos={todos} applicationId={applicationId} timezone={timezone} />

      {otherAttempts.length > 0 && (
        <section className="rounded-card border border-border bg-surface p-4">
          <h3 className="text-[13px] font-semibold text-ink">Earlier attempts</h3>
          <p className="mt-0.5 text-[12px] text-ink-muted">
            Kept as history rather than overwritten — which is the whole reason a pursuit is a
            separate row from the posting.
          </p>
          <ul className="mt-2 space-y-1.5">
            {otherAttempts.map((attempt) => (
              <li key={attempt.id} className="flex items-center gap-2 text-[13px]">
                <span className="tabular text-ink-faint">#{attempt.attempt}</span>
                <StatusBadge status={attempt.status} everSubmitted={attempt.submittedAt !== null} />
                <span className="text-ink-muted">{formatDate(attempt.submittedAt, timezone)}</span>
                {attempt.rejectionStage && (
                  <span className="text-ink-faint">at {attempt.rejectionStage}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {events.length === 0 ? (
        <p className="rounded-card border border-dashed border-border bg-surface px-4 py-10 text-center text-[13px] text-ink-muted">
          Nothing has happened yet. Events appear here as mail arrives, or when you move the card.
        </p>
      ) : (
        <ol className="space-y-2">
          {events.map((event) => (
            <li
              key={event.id}
              className={cn(
                'flex gap-3 rounded-card border border-border bg-surface px-4 py-2.5',
                event.needsReview && 'border-accent-orange bg-accent-orange-tint',
              )}
            >
              <span className="tabular w-28 shrink-0 text-[12px] text-ink-faint">
                {formatDate(event.occurredAt, timezone)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-ink">
                  {event.gmailHref ? (
                    <GmailLink href={event.gmailHref}>
                      {event.summary ?? event.kind.replace(/_/g, ' ')}
                    </GmailLink>
                  ) : (
                    (event.summary ?? event.kind.replace(/_/g, ' '))
                  )}
                </p>
                <p className="text-[11px] text-ink-faint">
                  {event.kind.replace(/_/g, ' ')} · {event.source}
                </p>
                {event.needsReview && (
                  <p className="mt-1 flex items-start gap-1.5 text-[12px] text-ink">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-accent-orange" strokeWidth={2} />
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
}: {
  todos: PanelProps['todos'];
  applicationId: string;
  timezone: string;
}) {
  const [body, setBody] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h3 className="mb-2 text-[13px] font-semibold text-ink">To-dos</h3>
      {todos.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {todos.map((todo) => (
            <li key={todo.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              <span className="tabular text-ink-faint">{formatDate(todo.dueAt, timezone)}</span>
              <span className="text-ink">{todo.body}</span>
              <ReminderActions id={todo.id} />
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
        {error && <span className="text-[12px] text-status-rejected">{error}</span>}
      </div>
    </section>
  );
}

function Posting({
  roleId,
  jdText,
  jdUrl,
  atsJobId,
  compMinCents,
  compMaxCents,
  compSource,
  requirements,
}: PanelProps) {
  const groups: Array<{ kind: Requirement['kind']; label: string }> = [
    { kind: 'must_have', label: 'Must have' },
    { kind: 'nice_to_have', label: 'Nice to have' },
    { kind: 'responsibility', label: 'What the role does' },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-card border border-border bg-surface p-4">
        <h3 className="text-[13px] font-semibold text-ink">Requirement map</h3>
        <p className="mt-0.5 text-[12px] text-ink-muted">
          Extracted once from the description. In Phase 2 each line gets your best matching
          evidence beside it, scored strong, partial or gap.
        </p>
        {requirements.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-faint">
            No description saved yet, so there is nothing to map.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {groups.map((group) => {
              const items = requirements.filter((r) => r.kind === group.kind);
              if (items.length === 0) return null;
              return (
                <div key={group.kind}>
                  <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                    {group.label}
                  </h4>
                  <ul className="mt-1 space-y-1">
                    {items.map((item, index) => (
                      <li key={`${group.kind}-${index}`} className="flex gap-2 text-[13px] text-ink">
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden />
                        {item.text}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="space-y-4">
        <RoleDetailsCard
          roleId={roleId}
          jdUrl={jdUrl}
          atsJobId={atsJobId}
          compMinCents={compMinCents}
          compMaxCents={compMaxCents}
          compSource={compSource}
        />

        <JobDescriptionCard roleId={roleId} jdText={jdText} />
      </div>
    </div>
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
          <h3 className="text-[13px] font-semibold text-ink">Details</h3>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-ink-faint hover:text-ink"
            title="Edit posting details"
          >
            <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
        <dl className="mt-2 space-y-1.5 text-[13px]">
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 text-ink-faint">Posting link</dt>
            <dd className="min-w-0 flex-1 truncate">
              {jdUrl ? (
                <a
                  href={jdUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-brand underline underline-offset-2"
                >
                  {jdUrl}
                </a>
              ) : (
                <span className="text-ink-faint">—</span>
              )}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 text-ink-faint">ATS job id</dt>
            <dd className="text-ink">{atsJobId ?? <span className="text-ink-faint">—</span>}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="w-24 shrink-0 text-ink-faint">Compensation</dt>
            <dd className="text-ink">
              {compBand ?? <span className="text-ink-faint">—</span>}
              {compBand && compSource && (
                <span className="ml-1.5 text-[12px] text-ink-faint">from the {compSource}</span>
              )}
            </dd>
          </div>
        </dl>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <h3 className="text-[13px] font-semibold text-ink">Details</h3>
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
      {error && <p className="mt-2 text-[13px] text-status-rejected">{error}</p>}
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
function JobDescriptionCard({ roleId, jdText }: { roleId: string; jdText: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(jdText);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

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

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink">Job description</h3>
        {!editing && (
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
          {error && <p className="mt-2 text-[13px] text-status-rejected">{error}</p>}
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
        <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-muted">
          {jdText}
        </pre>
      ) : (
        <p className="mt-3 text-[13px] text-ink-faint">
          Nothing saved. Add the description to build the requirement map and fill in the comp
          band automatically.
        </p>
      )}
    </section>
  );
}

function Answers({ answers, applicationId }: PanelProps) {
  const [paste, setPaste] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="space-y-4">
      <section className="rounded-card border border-border bg-surface p-4">
        <h3 className="text-[13px] font-semibold text-ink">Add the application questions</h3>
        <p className="mt-0.5 text-[12px] text-ink-muted">
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
          {message && <span className="text-[12px] text-ink-muted">{message}</span>}
        </div>
      </section>

      {answers.length === 0 ? (
        <p className="rounded-card border border-dashed border-border bg-surface px-4 py-10 text-center text-[13px] text-ink-muted">
          No questions captured for this application yet.
        </p>
      ) : (
        <div className="space-y-3">
          {answers.map((answer) => (
            <AnswerCard key={answer.id} answer={answer} />
          ))}
        </div>
      )}
    </div>
  );
}

function AnswerCard({ answer }: { answer: PanelProps['answers'][number] }) {
  const [text, setText] = useState(answer.answer || answer.canonicalAnswer || '');
  const [status, setStatus] = useState(answer.status);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const usingCanonical = !answer.answer && Boolean(answer.canonicalAnswer);

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-ink">{answer.questionText}</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">
            {answer.questionKind}
            {answer.timesSeen > 1 && ` · asked ${answer.timesSeen} times`}
          </p>
        </div>
        {status === 'approved' && (
          <CheckCircle2 className="size-4 shrink-0 text-status-offer" strokeWidth={2} />
        )}
      </div>

      {usingCanonical && (
        <p className="mt-2 rounded bg-brand-tint px-2 py-1 text-[12px] text-brand">
          Filled from your default answer for this question. Edit it if this one needs tailoring.
        </p>
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
        {saved && <span className="text-[12px] text-ink-muted">{saved}</span>}
      </div>
    </section>
  );
}

function Interviews({ interviews, applicationId, timezone, focusInterviewId }: PanelProps) {
  return (
    <div className="space-y-3">
      {interviews.length === 0 ? (
        <p className="rounded-card border border-dashed border-border bg-surface px-4 py-10 text-center text-[13px] text-ink-muted">
          No interviews yet. They appear here when a scheduling email arrives, or you can add one
          below.
        </p>
      ) : (
        interviews.map((interview) => (
          <InterviewCard
            key={interview.id}
            interview={interview}
            timezone={timezone}
            focused={interview.id === focusInterviewId}
          />
        ))
      )}
      <AddInterview applicationId={applicationId} nextRound={interviews.length + 1} />
    </div>
  );
}

function InterviewCard({
  interview,
  timezone,
  focused = false,
}: {
  focused?: boolean;
  interview: PanelProps['interviews'][number];
  timezone: string;
}) {
  const [prep, setPrep] = useState(interview.prepNotes);
  const [notes, setNotes] = useState(interview.notes);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const ref = useRef<HTMLElement>(null);

  const needsDebrief = interview.debriefDue && !notes;

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
        focused && 'ring-2 ring-brand ring-offset-2 ring-offset-canvas',
      )}
    >
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink">
          Round {interview.round} · {interview.kind.replace(/_/g, ' ')}
        </h3>
        <span className="tabular text-[12px] text-ink-muted">
          {formatDateTime(interview.scheduledAt, timezone)}
        </span>
      </header>

      {needsDebrief && (
        <p className="mt-2 rounded bg-accent-orange-tint px-2 py-1.5 text-[12px] text-ink">
          Write the debrief tonight. One written three days later is worth very little.
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Prep
          </label>
          <Textarea rows={4} value={prep} onChange={(e) => setPrep(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Interview notes
          </label>
          <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {interview.questionsAsked.length > 0 && (
        <div className="mt-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Questions they asked
          </h4>
          <ul className="mt-1 space-y-0.5 text-[13px] text-ink-muted">
            {interview.questionsAsked.map((question, index) => (
              <li key={index}>· {question}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
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
        {saved && <span className="text-[12px] text-ink-muted">{saved}</span>}
        <span className="ml-auto">
          {confirmingDelete ? (
            <span className="flex items-center gap-2">
              <span className="text-[12px] text-ink-muted">Delete this round?</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => startTransition(() => void deleteInterview(interview.id))}
                className="press text-[12px] font-medium text-status-rejected"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="text-[12px] text-ink-faint hover:text-ink"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="text-[12px] text-ink-faint underline underline-offset-2 hover:text-status-rejected"
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
 * The other half of "I don't know why it says 2 separate rounds": the inbox
 * sometimes reads one scheduling back-and-forth as two, and the fix used to
 * require filing a bug. Now it's the button above. This is its mirror --
 * adding a round the inbox never saw at all, a phone screen nobody emailed
 * about.
 */
function AddInterview({ applicationId, nextRound }: { applicationId: string; nextRound: number }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('recruiter_screen');
  const [scheduledAt, setScheduledAt] = useState('');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press w-full rounded-card border border-dashed border-border bg-surface py-2.5 text-center text-[13px] text-ink-muted hover:border-brand hover:text-brand"
      >
        Add a round
      </button>
    );
  }

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="interview-kind">Kind</Label>
          <Select
            id="interview-kind"
            value={kind}
            onChange={(event) => setKind(event.target.value)}
            className="w-48"
          >
            <option value="recruiter_screen">Recruiter screen</option>
            <option value="hiring_manager">Hiring manager</option>
            <option value="technical">Technical</option>
            <option value="case">Case study</option>
            <option value="panel">Panel</option>
            <option value="onsite">Onsite</option>
            <option value="final">Final</option>
            <option value="informal">Informal</option>
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
                setOpen(false);
                setScheduledAt('');
              }
            })
          }
        >
          Add round {nextRound}
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-ink-faint hover:text-ink">
          Cancel
        </button>
        {error && <span className="text-[12px] text-status-rejected">{error}</span>}
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
          {error && <span className="text-[12px] text-status-rejected">{error}</span>}
        </div>
      </section>

      {notes.map((note) => (
        <article key={note.id} className="rounded-card border border-border bg-surface p-4">
          <p className="whitespace-pre-wrap text-[13px] text-ink">{note.body}</p>
          <p className="tabular mt-1.5 text-[11px] text-ink-faint">
            {formatDate(note.createdAt, timezone)}
          </p>
        </article>
      ))}
    </div>
  );
}

function LinkedMail(props: PanelProps) {
  const { messages, timezone, applicationId, companyName, matchCandidates } = props;

  return (
    <div className="space-y-4">
      <MatchCandidates
        applicationId={applicationId}
        companyName={companyName}
        candidates={matchCandidates}
        timezone={timezone}
      />

      {messages.length === 0 ? (
        <p className="rounded-card border border-dashed border-border bg-surface px-4 py-10 text-center text-[13px] text-ink-muted">
          No mail has been linked to this pursuit yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-ink-faint">
                <th className="px-2 py-2 font-semibold">Received</th>
                <th className="px-2 py-2 font-semibold">Subject</th>
                <th className="px-2 py-2 font-semibold">Kind</th>
                <th className="px-2 py-2 font-semibold">Linked by</th>
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
                  <td className="tabular px-2 py-1.5 text-ink-faint">
                    {message.linkMethod?.replace(/_/g, ' ') ?? '—'}
                    {message.linkConfidence !== null &&
                      ` (${Math.round(message.linkConfidence * 100)}%)`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-ink-faint">
            Subjects and senders only. Message bodies are never stored.
          </p>
        </div>
      )}
    </div>
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
          <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ink">
            Possible matches — {visible.length}
          </summary>
          <div className="space-y-2 border-t border-border p-3">
            <p className="text-[11px] text-ink-faint">
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

      {error && <p className="text-[12px] text-status-rejected">{error}</p>}

      {searching ? (
        <AddOtherSearch applicationId={applicationId} timezone={timezone} onClose={() => setSearching(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setSearching(true)}
          className="text-[12px] font-medium text-brand underline underline-offset-2"
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
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-canvas px-2.5 py-2 text-[13px]">
      <span className="tabular w-full text-[11px] text-ink-faint sm:w-32">
        {formatDate(message.receivedAt, timezone)}
      </span>
      <span className="min-w-0 flex-1 truncate text-ink">
        {message.gmailHref ? (
          <GmailLink href={message.gmailHref}>{message.subject ?? '(no subject)'}</GmailLink>
        ) : (
          (message.subject ?? '—')
        )}
      </span>
      <span className="truncate text-[11px] text-ink-faint">{message.fromAddress ?? ''}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {onDecline && (
          <button
            type="button"
            disabled={busy}
            onClick={onDecline}
            className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink disabled:opacity-50"
          >
            Not a match
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={onLink}
          className="press rounded-lg border border-border bg-surface px-2 py-0.5 text-[12px] font-medium text-ink disabled:opacity-50"
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
          className="text-[12px] text-ink-muted underline underline-offset-2 hover:text-ink"
        >
          Close
        </button>
      </div>
      {error && <p className="mt-2 text-[12px] text-status-rejected">{error}</p>}
      {results !== null && (
        <ul className="mt-2 space-y-1.5">
          {results.length === 0 && (
            <li className="text-[12px] text-ink-faint">No unlinked mail matches that.</li>
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
