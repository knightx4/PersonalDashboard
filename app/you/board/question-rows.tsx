'use client';

import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { RowLink } from '@/components/shell/back-link';
import { Button } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';
import { FieldError } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { formatDateTime } from '@/lib/jobs/applications/load';
import type { MeetingState } from '@/lib/you/board';
import type { BoardAdvisor, BoardQuestion } from '@/lib/you/board-questions';
import type { AskWhen } from './ask-board';

/**
 * The Board tab's question rows (plan #2561.4): the board's suggestions, each
 * with Ask now and Save for Sunday under it and Dismiss as a cross at its
 * right, and the person's asked
 * questions with the state each is in. A question in a meeting opens that
 * meeting; one whose meeting stopped can be asked again.
 */

export type QuestionActions = {
  /** Accept a suggestion, for Sunday or now. */
  accept: (id: string, when: AskWhen) => Promise<{ error: string | null }>;
  dismiss: (id: string) => Promise<{ error: string | null }>;
  /** Convene a meeting now about a queued question, or one whose meeting stopped. */
  convene: (id: string) => Promise<{ error: string | null }>;
};

function OptionsLine({ question }: { question: BoardQuestion }) {
  if (question.options.length === 0) return null;
  return (
    <ol className="mt-1 space-y-0.5 text-small text-ink-muted">
      {question.options.map((option) => (
        <li key={option.letter} className="flex gap-2">
          <span className="tabular w-3 shrink-0 font-semibold">{option.letter}</span>
          <span className="min-w-0">{option.text}</span>
        </li>
      ))}
    </ol>
  );
}

/** "Hear from: the CFO, WB" style line, guests by name since the row has room. */
function advisorsLine(keys: readonly string[], roster: readonly BoardAdvisor[]): string | null {
  if (keys.length === 0) return null;
  const names = keys.map((key) => roster.find((a) => a.key === key)?.name ?? key);
  return `Hearing from ${names.join(', ')}`;
}

export function SuggestionRow({
  question,
  actions,
  error: startError = null,
}: {
  question: BoardQuestion;
  actions: QuestionActions;
  /** A failure to start with. Only the gallery sets it. */
  error?: string | null;
}) {
  const [pending, setPending] = useState<AskWhen | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(startError);
  const [, startTransition] = useTransition();
  const run = (what: AskWhen | 'dismiss') => {
    setPending(what);
    setError(null);
    startTransition(async () => {
      const result = what === 'dismiss' ? await actions.dismiss(question.id) : await actions.accept(question.id, what);
      setPending(null);
      if (result.error) setError(result.error);
    });
  };
  const busy = pending !== null;
  return (
    <li className="card-pad-x row-pad">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-ui text-ink">{question.question}</p>
          <OptionsLine question={question} />
        </div>
        <Tooltip label="Dismiss this suggestion" align="end">
          <IconButton
            label="Dismiss this suggestion"
            className="-mr-2 -mt-1"
            disabled={busy}
            onClick={() => run('dismiss')}
          >
            <X aria-hidden strokeWidth={1.75} />
          </IconButton>
        </Tooltip>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <DashAction
          type="button"
          size="sm"
          variant="secondary"
          routine="board"
          what="Cost of asking the board now"
          align="start"
          pending={pending === 'now'}
          disabled={busy}
          onClick={() => run('now')}
        >
          {pending === 'now' ? 'Convening…' : 'Ask now'}
        </DashAction>
        <Button type="button" size="sm" variant="secondary" pending={pending === 'sunday'} disabled={busy} onClick={() => run('sunday')}>
          Save for Sunday
        </Button>
      </div>
      <FieldError>{error}</FieldError>
    </li>
  );
}

export function AskedRow({
  question,
  meeting,
  roster,
  nextMeeting,
  timezone,
  now,
  actions,
  notice = null,
}: {
  question: BoardQuestion;
  /** Why a meeting asked for on the compose card did not start, shown on this row. */
  notice?: string | null;
  /** The state of the meeting it is in, when it is in one. */
  meeting: MeetingState | null;
  roster: readonly BoardAdvisor[];
  /** "Sunday 8 Nov", for a queued question. */
  nextMeeting: string;
  timezone: string;
  now: number;
  actions: QuestionActions;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const shown = error ?? (pending ? null : notice);
  const convene = () => {
    setPending(true);
    setError(null);
    startTransition(async () => {
      const result = await actions.convene(question.id);
      setPending(false);
      if (result.error) setError(result.error);
    });
  };

  const inMeeting = meeting?.kind === 'running';
  const state = inMeeting
      ? `In a meeting now, started ${formatDateTime(meeting.since, timezone, now)}`
      : question.status === 'discussing' && meeting?.kind === 'failed'
        ? `The meeting did not finish: ${meeting.error}`
        : question.status === 'discussing'
          ? 'Discussed, waiting on your decision'
          : question.status === 'deferred'
            ? 'Put off'
            : `For ${nextMeeting}`;
  const meta = [
    state,
    question.lean ? `you lean ${question.lean}` : null,
    question.options.length === 0 ? 'the chair writes the options' : null,
    advisorsLine(question.advisors, roster),
  ]
    .filter(Boolean)
    .join(' · ');
  const canConvene =
    !inMeeting &&
    (question.status === 'queued' ||
      question.status === 'deferred' ||
      (question.status === 'discussing' && meeting?.kind === 'failed'));

  const body = (
    <span className="min-w-0 flex-1">
      <span className="line-clamp-2 block text-ui text-ink">{question.question}</span>
      <span className="block text-small text-ink-muted">{meta}</span>
    </span>
  );

  if (question.meetingId && !canConvene) {
    return (
      <li>
        <RowLink
          href={`/you/board/${question.meetingId}`}
          className="card-pad-x row-pad flex min-h-11 items-center gap-3 hover:bg-sunken"
        >
          {body}
        </RowLink>
      </li>
    );
  }

  return (
    <li className="card-pad-x row-pad">
      {/* On a phone the press goes under the question, so the question keeps the row's width. */}
      <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
        {body}
        {canConvene && (
          <DashAction
            type="button"
            size="sm"
            variant="secondary"
            routine="board"
            what="Cost of asking the board now"
            align="start"
            pending={pending}
            onClick={convene}
          >
            {pending ? 'Convening…' : question.status === 'discussing' ? 'Ask again' : 'Ask now'}
          </DashAction>
        )}
      </div>
      <FieldError>{shown}</FieldError>
    </li>
  );
}
