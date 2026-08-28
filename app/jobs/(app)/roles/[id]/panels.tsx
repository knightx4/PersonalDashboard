'use client';

import { useState, useTransition } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  FileText,
  ListChecks,
  Mail,
  MessageSquareText,
  StickyNote,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { StatusBadge } from '@/components/jobs/ui/status-badge';
import { formatDate, formatDateTime } from '@/lib/jobs/applications/load';
import type { ApplicationStatus } from '@/lib/jobs/pipeline';
import type { Requirement } from '@/lib/jobs/jd/requirements';
import { addQuestions, promoteToCanonical, saveAnswer } from '../actions';
import { addNote, saveInterview } from './actions';

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
  requirements: Requirement[];
  timezone: string;
  events: Array<{
    id: string;
    kind: string;
    occurredAt: string;
    source: string;
    summary: string | null;
    needsReview: boolean;
  }>;
  interviews: Array<{
    id: string;
    round: number;
    kind: string;
    scheduledAt: string | null;
    /** Computed on the server: reading the clock during render is unstable. */
    isPast: boolean;
    format: string | null;
    status: string;
    prepNotes: string;
    debrief: string;
    wentWell: string;
    wentPoorly: string;
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
  messages: Array<{
    id: string;
    subject: string | null;
    fromAddress: string | null;
    receivedAt: string | null;
    classification: string;
    linkMethod: string | null;
    linkConfidence: number | null;
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

export function RoleDetailPanels(props: PanelProps) {
  const [tab, setTab] = useState<Tab>('timeline');

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
    </div>
  );
}

function Timeline({ events, timezone, otherAttempts }: PanelProps) {
  return (
    <div className="space-y-4">
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
                <StatusBadge status={attempt.status} />
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
                  {event.summary ?? event.kind.replace(/_/g, ' ')}
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

function Posting({ jdText, requirements }: PanelProps) {
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

      <section className="rounded-card border border-border bg-surface p-4">
        <h3 className="text-[13px] font-semibold text-ink">Job description</h3>
        {jdText ? (
          <pre className="mt-2 max-h-[32rem] overflow-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink-muted">
            {jdText}
          </pre>
        ) : (
          <p className="mt-3 text-[13px] text-ink-faint">
            Nothing saved. Paste the description on this role to build the requirement map.
          </p>
        )}
      </section>
    </div>
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

function Interviews({ interviews, timezone }: PanelProps) {
  if (interviews.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-border bg-surface px-4 py-10 text-center text-[13px] text-ink-muted">
        No interviews yet. They appear here when a scheduling email arrives, or you can add one by
        hand from the interviews page.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {interviews.map((interview) => (
        <InterviewCard key={interview.id} interview={interview} timezone={timezone} />
      ))}
    </div>
  );
}

function InterviewCard({
  interview,
  timezone,
}: {
  interview: PanelProps['interviews'][number];
  timezone: string;
}) {
  const [prep, setPrep] = useState(interview.prepNotes);
  const [wentWell, setWentWell] = useState(interview.wentWell);
  const [wentPoorly, setWentPoorly] = useState(interview.wentPoorly);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const needsDebrief = interview.isPast && !wentWell && !wentPoorly;

  return (
    <section className="rounded-card border border-border bg-surface p-4">
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

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Prep
          </label>
          <Textarea rows={4} value={prep} onChange={(e) => setPrep(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Went well
          </label>
          <Textarea rows={4} value={wentWell} onChange={(e) => setWentWell(e.target.value)} />
        </div>
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Went poorly
          </label>
          <Textarea rows={4} value={wentPoorly} onChange={(e) => setWentPoorly(e.target.value)} />
        </div>
      </div>
      <p className="mt-1 text-[11px] text-ink-faint">
        Two boxes, not one: a single box gets written as a paragraph and never reread.
      </p>

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
              const result = await saveInterview(interview.id, {
                prepNotes: prep,
                wentWell,
                wentPoorly,
              });
              setSaved(result.error ?? 'Saved.');
            })
          }
        >
          Save notes
        </Button>
        {saved && <span className="text-[12px] text-ink-muted">{saved}</span>}
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

function LinkedMail({ messages, timezone }: PanelProps) {
  if (messages.length === 0) {
    return (
      <p className="rounded-card border border-dashed border-border bg-surface px-4 py-10 text-center text-[13px] text-ink-muted">
        No mail has been linked to this pursuit yet.
      </p>
    );
  }

  return (
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
              <td className="px-2 py-1.5 text-ink">{message.subject ?? '—'}</td>
              <td className="px-2 py-1.5 text-ink-muted">
                {message.classification.replace(/_/g, ' ')}
              </td>
              <td className="tabular px-2 py-1.5 text-ink-faint">
                {message.linkMethod?.replace(/_/g, ' ') ?? '—'}
                {message.linkConfidence !== null && ` (${Math.round(message.linkConfidence * 100)}%)`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-ink-faint">
        Subjects and senders only. Message bodies are never stored.
      </p>
    </div>
  );
}
