'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Textarea } from '@/components/ui/field';
import { PaidHint } from '@/components/ui/paid-hint';
import { cn } from '@/lib/cn';
import { nextDueLine, type DueReview, type ReviewQuestion } from '@/lib/learn/lessons/review';
import { answerReview, askReview, type AnswerReviewResult, type AskReviewResult } from './actions';

/**
 * Ideas from passed pieces that are due for review (plan #1145), in Learn now
 * and at the top of a piece's page. One surface with a row an idea: Ask me
 * writes the question, Check my answer marks it and says when the idea comes
 * back. An answered row stays on the page until it is next opened.
 */
export function ReviewList({
  reviews,
  title,
  description,
  showPlan,
}: {
  reviews: readonly DueReview[];
  title: string;
  description: string;
  /** Whether each row names the plan and piece it came from, for Learn now. */
  showPlan: boolean;
}) {
  if (reviews.length === 0) return null;
  return (
    <Card padding="none" className="mb-4">
      <div className="card-pad-x pt-(--card-p)">
        <h2 className="text-ui font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-small text-ink-muted">{description}</p>
      </div>
      <ul className="divide-y divide-border">
        {reviews.map((review) => (
          <li key={review.conceptId} className="card-pad-x row-pad">
            <ReviewRow review={review} showPlan={showPlan} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ReviewRow({ review, showPlan }: { review: DueReview; showPlan: boolean }) {
  const [question, setQuestion] = useState<ReviewQuestion | null>(review.open);
  const [nextInDays, setNextInDays] = useState<number | null>(null);
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [asking, startAsking] = useTransition();
  const [marking, startMarking] = useTransition();

  const ask = () =>
    startAsking(async () => {
      setError(null);
      const result: AskReviewResult = await askReview(review.conceptId).catch(() => ({
        error: 'Could not write a question. Check your connection.',
      }));
      if (result.question) {
        setQuestion(result.question);
        setResponse('');
      } else setError(result.error ?? 'Could not write a question.');
    });

  const answer = () =>
    startMarking(async () => {
      if (!question) return;
      setError(null);
      const result: AnswerReviewResult = await answerReview(question.id, response).catch(() => ({
        error: 'Could not mark that. Check your connection.',
      }));
      if (result.question) {
        setQuestion(result.question);
        if (result.nextInDays !== undefined) setNextInDays(result.nextInDays);
      } else setError(result.error ?? 'Could not mark that.');
    });

  const answered = question !== null && question.correct !== null;
  const fieldId = `review-${review.conceptId}`;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-body font-medium text-ink">{review.name}</h3>
        {showPlan && (
          <Link
            href={`/learn/s/${review.subjectId}/p/${review.pieceId}`}
            className="text-small text-ink-muted underline underline-offset-2 hover:text-ink"
          >
            {review.trackName ? `${review.trackName} · ` : ''}
            {review.pieceTitle}
          </Link>
        )}
      </div>

      {question && (
        <p className="mt-2 text-body text-ink" aria-live="polite">
          {question.question}
        </p>
      )}

      {question && !answered && (
        <>
          <Field label="Your answer" id={fieldId} hint="A sentence or two, from memory.">
            <Textarea
              id={fieldId}
              rows={2}
              maxLength={2000}
              value={response}
              onChange={(event) => setResponse(event.target.value)}
              disabled={marking}
            />
          </Field>
          <span className="mt-2 inline-flex items-center gap-1">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={answer}
              pending={marking}
              disabled={response.trim() === ''}
            >
              {marking ? 'Marking…' : 'Check my answer'}
            </Button>
            <PaidHint action="app/learn/review/actions.ts#answerReview" what="Cost of marking the answer" />
          </span>
        </>
      )}

      {question && answered && (
        <div className="mt-2 space-y-1" aria-live="polite">
          {question.response && <p className="text-ui text-ink-muted">You wrote: {question.response}</p>}
          <p className={cn('flex items-center gap-1.5 text-ui font-medium', question.correct ? 'text-ink' : 'text-ink-muted')}>
            {question.correct ? (
              <Check className="size-4" strokeWidth={2} aria-hidden />
            ) : (
              <X className="size-4" strokeWidth={2} aria-hidden />
            )}
            {question.correct ? 'Right.' : 'Not this time.'}
          </p>
          {question.why && <p className="text-ui text-ink">{question.why}</p>}
          {question.expected && <p className="text-ui text-ink-muted">Expected: {question.expected}</p>}
          {nextInDays !== null && <p className="text-small text-ink-muted">{nextDueLine(nextInDays)}</p>}
        </div>
      )}

      {!question && (
        <span className="mt-2 inline-flex items-center gap-1">
          <Button type="button" variant="secondary" size="sm" onClick={ask} pending={asking}>
            {asking ? 'Writing a question…' : 'Ask me'}
          </Button>
          <PaidHint action="app/learn/review/actions.ts#askReview" what="Cost of writing the question" />
        </span>
      )}

      {error && <p className="mt-2 text-small text-danger">{error}</p>}
    </div>
  );
}
