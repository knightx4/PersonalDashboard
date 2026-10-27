'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { heldOnLabel, SEAT_LABELS, SEATS, type Seat } from '@/lib/you/board';
import { optionLabel } from '@/lib/you/board-questions';
import {
  OUTCOME_LABELS,
  OUTCOMES,
  type DecisionReview,
  type Outcome,
  type ReviewAt,
  type ReviewGrade,
} from '@/lib/you/board-reviews';
import { Evidence, Prose } from './[id]/prose';

/**
 * One check-back on a decision (plan #2561.8), on the Board tab and on the
 * meeting that wrote it: the question and what was chosen, how it turned out
 * with its receipts, then the board's one line and three presses to answer
 * it. Once answered, the answer shows with Change, and under it whose pick
 * held up.
 */

export type ReviewAnswerAction = (
  questionId: string,
  at: ReviewAt,
  outcome: Outcome,
) => Promise<{ error: string | null }>;

/** An advisor's name: the roster's, a seat's label, or the key itself. */
export function advisorName(key: string, names: Readonly<Record<string, string>>): string {
  return names[key] ?? ((SEATS as readonly string[]).includes(key) ? SEAT_LABELS[key as Seat] : key);
}

/** "Held up: Mentor, CFO. Did not: Skeptic.", or null when nothing was graded. */
export function gradesLine(grades: readonly ReviewGrade[], names: Readonly<Record<string, string>>): string | null {
  const held = grades.filter((g) => g.held === true).map((g) => advisorName(g.advisor, names));
  const missed = grades.filter((g) => g.held === false).map((g) => advisorName(g.advisor, names));
  if (held.length === 0 && missed.length === 0) return null;
  return [
    held.length ? `Picks that held up: ${held.join(', ')}.` : null,
    missed.length ? `Did not: ${missed.join(', ')}.` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

/** "30 days on · You chose A, Take the contract · decided 28 Sep 2026". */
export function reviewMeta(review: DecisionReview): string {
  const chose = optionLabel(review.options, review.option ?? review.chosen);
  return [
    `${review.at} days on`,
    chose ? `You chose ${chose}` : null,
    review.decidedAt ? `decided ${heldOnLabel(review.decidedAt.slice(0, 10))}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function ReviewRow({
  review,
  names,
  answer,
  startError = null,
}: {
  review: DecisionReview;
  /** Advisor names by key. */
  names: Readonly<Record<string, string>>;
  answer: ReviewAnswerAction;
  /** Draw the presses with this failure showing. Only the gallery sets it. */
  startError?: string | null;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(review.outcome);
  const [open, setOpen] = useState(review.outcome === null);
  const [error, setError] = useState<string | null>(startError);
  const [pending, startTransition] = useTransition();
  const [pressed, setPressed] = useState<Outcome | null>(null);
  const press = (value: Outcome) => {
    setError(null);
    setPressed(value);
    startTransition(async () => {
      const result = await answer(review.questionId, review.at, value);
      setPressed(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOutcome(value);
      setOpen(false);
    });
  };
  // The grades on the row are the saved answer's; a new answer's grades arrive with the page.
  const graded = outcome === review.outcome ? gradesLine(review.grades, names) : null;
  return (
    <li className="card-pad-x row-pad space-y-2">
      <div className="space-y-0.5">
        <p className="text-ui font-medium text-ink [overflow-wrap:anywhere]">{review.question}</p>
        <p className="text-small text-ink-muted [overflow-wrap:anywhere]">{reviewMeta(review)}</p>
      </div>
      <Prose markdown={review.account} />
      <Evidence receipts={review.receipts} written={[review.account]} />
      <div className="space-y-2 pt-1">
        <p className="text-ui text-ink [overflow-wrap:anywhere]">{review.ask}</p>
        {open ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={review.ask}>
            {OUTCOMES.map((value) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant="secondary"
                pressed={outcome === value}
                pending={pending && pressed === value}
                disabled={pending}
                onClick={() => press(value)}
              >
                {OUTCOME_LABELS[value]}
              </Button>
            ))}
            {outcome && (
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-0.5 text-small text-ink-muted [overflow-wrap:anywhere]">
              <p>{`You: ${outcome ? OUTCOME_LABELS[outcome] : ''}`}</p>
              {graded && <p>{graded}</p>}
            </div>
            <Button type="button" size="sm" variant="secondary" className="shrink-0" onClick={() => setOpen(true)}>
              Change
            </Button>
          </div>
        )}
        <FieldError>{error}</FieldError>
      </div>
    </li>
  );
}
