'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/field';
import { PaidHint } from '@/components/ui/paid-hint';
import { cn } from '@/lib/cn';
import type { PieceCheck } from '@/lib/learn/lessons/piece-check';
import type { PieceIdea } from '@/lib/learn/lessons/piece-store';
import { answerPieceCheck, askPieceCheck, writeLessonForPiece, type AnswerResult, type AskResult } from './actions';

/**
 * A piece's lessons in order, then its check (plan #1141).
 *
 * Ideas with no lesson yet are written one after another as the page opens,
 * first idea first, so the top of the page fills while the rest are written.
 * The check is asked for with a press, written then, and marked on Check my
 * answer. A wrong answer shows what was missing and offers another question.
 */

type Writing = { state: 'waiting' | 'writing' } | { state: 'failed'; detail: string };

export function PieceLessons({
  subjectId,
  pieceId,
  ideas: initial,
}: {
  subjectId: string;
  pieceId: string;
  ideas: PieceIdea[];
}) {
  const [ideas, setIdeas] = useState(initial);
  const [writing, setWriting] = useState<Record<string, Writing>>(() =>
    Object.fromEntries(
      initial
        .filter((idea) => !idea.lesson && !idea.dropped)
        .map((idea) => [idea.conceptId, { state: 'waiting' } as Writing]),
    ),
  );
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const missing = initial.filter((idea) => !idea.lesson && !idea.dropped).map((idea) => idea.conceptId);
    if (missing.length === 0) return;
    void (async () => {
      for (const conceptId of missing) {
        setWriting((current) => ({ ...current, [conceptId]: { state: 'writing' } }));
        const result = await writeLessonForPiece(subjectId, pieceId, conceptId).catch(() => ({
          ok: false as const,
          detail: 'Could not reach the server. Reload the page to try again.',
        }));
        if (result.ok) {
          setIdeas((current) => current.map((idea) => (idea.conceptId === conceptId ? result.idea : idea)));
          setWriting((current) => {
            const next = { ...current };
            delete next[conceptId];
            return next;
          });
        } else {
          setWriting((current) => ({ ...current, [conceptId]: { state: 'failed', detail: result.detail } }));
        }
      }
    })();
  }, [initial, pieceId, subjectId]);

  return (
    <ol className="space-y-4">
      {ideas.map((idea, index) => (
        <li key={idea.conceptId}>
          <LessonCard idea={idea} number={index + 1} writing={writing[idea.conceptId] ?? null} />
        </li>
      ))}
    </ol>
  );
}

function LessonCard({ idea, number, writing }: { idea: PieceIdea; number: number; writing: Writing | null }) {
  const { lesson } = idea;
  return (
    <Card padding="standard">
      <p className="text-small text-ink-muted tabular-nums">Lesson {number}</p>
      <h2 className="mt-0.5 font-display text-title tracking-tight break-words text-ink">{idea.name}</h2>

      {lesson ? (
        <>
          <section className="mt-3 rounded-control border-l-2 border-accent bg-accent-tint px-3 py-2.5">
            <h3 className="text-small font-semibold text-accent">The takeaway</h3>
            <p className="mt-1 text-body font-medium text-ink">{lesson.takeaway}</p>
          </section>
          {lesson.context && <p className="mt-3 text-body text-ink">{lesson.context}</p>}
          {lesson.hook && <p className="mt-3 text-body font-semibold text-ink">{lesson.hook}</p>}
          {lesson.summary && <p className="mt-2 text-body text-ink">{lesson.summary}</p>}
          {lesson.example && (
            <section className="mt-4 rounded-control bg-accent-tint px-3 py-2.5">
              <h3 className="text-small font-semibold text-accent">In practice</h3>
              <p className="mt-1 text-body text-ink">{lesson.example}</p>
            </section>
          )}
          {lesson.question && lesson.answer && (
            <section className="mt-4">
              <h3 className="text-small font-semibold text-ink-muted">Try this</h3>
              <p className="mt-1 text-body text-ink">{lesson.question}</p>
              <details className="group mt-2">
                <summary className="press inline-flex cursor-pointer list-none items-center rounded-control text-ui font-medium text-accent [&::-webkit-details-marker]:hidden">
                  <span className="group-open:hidden">Show the answer</span>
                  <span className="hidden group-open:inline">Answer</span>
                </summary>
                <p className="mt-1 text-body text-ink">{lesson.answer}</p>
              </details>
            </section>
          )}
        </>
      ) : (
        <>
          <p className="mt-2 text-body text-ink">{idea.claim}</p>
          <p className="mt-2 text-small text-ink-muted" aria-live="polite">
            {idea.dropped
              ? `Dash could not write a lesson for this idea: ${idea.dropped}`
              : writing?.state === 'failed'
                ? `The lesson could not be written: ${writing.detail}`
                : writing?.state === 'writing'
                  ? 'Dash is writing this lesson…'
                  : 'Waiting for the lesson before it to be written…'}
          </p>
        </>
      )}
    </Card>
  );
}

export function PieceCheckCard({
  subjectId,
  pieceId,
  check: initialCheck,
  passedAt: initialPassedAt,
}: {
  subjectId: string;
  pieceId: string;
  check: PieceCheck | null;
  passedAt: string | null;
}) {
  const [check, setCheck] = useState(initialCheck);
  const [passedAt, setPassedAt] = useState(initialPassedAt);
  const [tested, setTested] = useState<number | null>(null);
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [asking, startAsking] = useTransition();
  const [marking, startMarking] = useTransition();

  const ask = () =>
    startAsking(async () => {
      setError(null);
      const result: AskResult = await askPieceCheck(subjectId, pieceId).catch(() => ({
        error: 'Could not write a question. Check your connection.',
      }));
      if (result.check) {
        setCheck(result.check);
        setResponse('');
      } else setError(result.error ?? 'Could not write a question.');
    });

  const answer = () =>
    startMarking(async () => {
      if (!check) return;
      setError(null);
      const result: AnswerResult = await answerPieceCheck(subjectId, pieceId, check.id, response).catch(() => ({
        error: 'Could not mark that. Check your connection.',
      }));
      if (result.check) {
        setCheck(result.check);
        if (result.passedAt) setPassedAt(result.passedAt);
        if (result.tested !== undefined) setTested(result.tested);
      } else setError(result.error ?? 'Could not mark that.');
    });

  const answered = check !== null && check.correct !== null;
  const canAsk = check === null || check.correct === false;

  return (
    <Card padding="standard">
      <h2 className="font-display text-title tracking-tight text-ink">Check</h2>
      <p className="mt-1 text-ui text-ink-muted">
        {passedAt
          ? 'You have passed this piece.'
          : 'One question needing this piece’s ideas together, answered from memory. A right answer passes the piece.'}
      </p>

      {check && (
        <p className="mt-3 text-body text-ink" aria-live="polite">
          {check.question}
        </p>
      )}

      {check && !answered && (
        <>
          <Field label="Your answer" id={`piece-check-${check.id}`} hint="A sentence or two, from memory.">
            <Textarea
              id={`piece-check-${check.id}`}
              rows={3}
              maxLength={2000}
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              disabled={marking}
            />
          </Field>
          <span className="mt-3 inline-flex items-center gap-1">
            <Button type="button" variant="primary" onClick={answer} pending={marking} disabled={response.trim() === ''}>
              {marking ? 'Marking…' : 'Check my answer'}
            </Button>
            <PaidHint action="app/learn/s/[id]/p/[piece]/actions.ts#answerPieceCheck" what="Cost of marking the answer" />
          </span>
        </>
      )}

      {check && answered && (
        <div className="mt-3 space-y-2" aria-live="polite">
          {check.response && <p className="text-ui text-ink-muted">You wrote: {check.response}</p>}
          <p className={cn('flex items-center gap-1.5 text-ui font-medium', check.correct ? 'text-ink' : 'text-ink-muted')}>
            {check.correct ? (
              <Check className="size-4" strokeWidth={2} aria-hidden />
            ) : (
              <X className="size-4" strokeWidth={2} aria-hidden />
            )}
            {check.correct ? 'Right.' : 'Not yet.'}
          </p>
          {check.why && <p className="text-ui text-ink">{check.why}</p>}
          {check.expected && <p className="text-ui text-ink-muted">Expected: {check.expected}</p>}
          {check.correct && tested !== null && (
            <p className="text-small text-ink-muted">
              Piece passed. {tested === 1 ? 'Its one idea is' : `Its ${tested} ideas are`} now marked tested.
            </p>
          )}
        </div>
      )}

      {canAsk && (
        <span className="mt-3 inline-flex items-center gap-1">
          <Button type="button" variant={check ? 'secondary' : 'primary'} onClick={ask} pending={asking}>
            {asking ? 'Writing a question…' : check ? 'Try another question' : 'Ask me the question'}
          </Button>
          <PaidHint action="app/learn/s/[id]/p/[piece]/actions.ts#askPieceCheck" what="Cost of writing the question" />
        </span>
      )}

      {error && <p className="mt-2 text-small text-danger">{error}</p>}
    </Card>
  );
}
