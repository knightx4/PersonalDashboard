'use client';

import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError, Textarea } from '@/components/ui/field';
import { ASK_TIMES_MAX, type PersonAsk } from '@/lib/you/board-asks';

/**
 * The Board tab's "The board asks you" rows (plan #2561.11): the facts the
 * board lacked on one of your questions. One row per question, with its
 * asks under it, each a line of text and an Answer press that opens the
 * box. The answer saves when you press Save and the next meeting reads it
 * first. An answered ask stays here, with your words under it, until a
 * meeting has read it.
 */

export type AskAnswerAction = (
  questionId: string,
  askId: string,
  answer: string,
) => Promise<{ error: string | null }>;

/** How often an unanswered ask has been put, once it has been put again. */
export function askedLine(ask: Pick<PersonAsk, 'askedIn' | 'answer'>): string | null {
  const times = ask.askedIn.length;
  if (ask.answer || times < 2) return null;
  return times >= ASK_TIMES_MAX
    ? 'Asked in three meetings. The board will not ask again.'
    : `Asked in ${times} meetings`;
}

/** The asks in the order given, grouped by the question each is about. */
export function groupByQuestion(asks: readonly PersonAsk[]): { questionId: string; question: string; asks: PersonAsk[] }[] {
  const groups: { questionId: string; question: string; asks: PersonAsk[] }[] = [];
  for (const ask of asks) {
    const group = groups.find((g) => g.questionId === ask.questionId);
    if (group) group.asks.push(ask);
    else groups.push({ questionId: ask.questionId, question: ask.question, asks: [ask] });
  }
  return groups;
}

export function AskQuestionRow({
  question,
  asks,
  answer,
  errorOn = null,
}: {
  question: string;
  asks: readonly PersonAsk[];
  answer: AskAnswerAction;
  /** Draw the first ask open with this failure showing. Only the gallery sets it. */
  errorOn?: string | null;
}) {
  return (
    <li className="card-pad-x row-pad">
      <p className="text-small text-ink-muted [overflow-wrap:anywhere]">{question}</p>
      <ul className="mt-2 space-y-4">
        {asks.map((ask, index) => (
          <AskItem
            key={ask.id}
            ask={ask}
            answer={answer}
            startError={index === 0 ? errorOn : null}
          />
        ))}
      </ul>
    </li>
  );
}

function AskItem({
  ask,
  answer: saveAnswer,
  startError,
}: {
  ask: PersonAsk;
  answer: AskAnswerAction;
  startError: string | null;
}) {
  const id = useId();
  const [saved, setSaved] = useState(ask.answer ?? '');
  const [draft, setDraft] = useState(
    ask.answer ?? (startError ? 'About 4,000 a month, and I would stop the course first.' : ''),
  );
  const [open, setOpen] = useState(startError !== null);
  const [error, setError] = useState<string | null>(startError);
  const [pending, startTransition] = useTransition();
  const press = () => {
    setError(null);
    startTransition(async () => {
      const result = await saveAnswer(ask.questionId, ask.id, draft);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(draft.trim());
      setOpen(false);
    });
  };
  const again = askedLine({ askedIn: ask.askedIn, answer: saved || null });
  return (
    <li>
      <label htmlFor={open ? id : undefined} className="block text-ui text-ink [overflow-wrap:anywhere]">
        {ask.text}
      </label>
      {open ? (
        <>
          <Textarea
            id={id}
            rows={2}
            className="mt-2"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-invalid={error ? true : undefined}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="secondary" pending={pending} disabled={!draft.trim() && !saved} onClick={press}>
              Save answer
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setDraft(saved);
                setError(null);
                setOpen(false);
              }}
            >
              Cancel
            </Button>
          </div>
          <FieldError>{error}</FieldError>
        </>
      ) : (
        <div className="mt-1 flex items-start gap-3">
          <div className="min-w-0 flex-1 text-small text-ink-muted [overflow-wrap:anywhere]">
            {saved ? (
              <>
                <p>{`You: ${saved}`}</p>
                <p>Saved. The next meeting reads it first.</p>
              </>
            ) : (
              again && <p>{again}</p>
            )}
          </div>
          <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => setOpen(true)}>
            {saved ? 'Change' : 'Answer'}
          </Button>
        </div>
      )}
    </li>
  );
}
