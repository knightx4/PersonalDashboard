'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/field';
import type { LessonPredict as Prediction } from '@/lib/learn/feed/card';

/**
 * A lesson that opens on a guess (plan #2522.6; LEARN-LESSONS-SPEC, "A
 * lesson").
 *
 * A lesson written with a prediction asks it first, with a box for the guess
 * and a Skip. The takeaway and the rest of the lesson open on either. The
 * guess is not marked and is not sent anywhere: it is set beside what is true
 * at the head of the lesson's context, which the caller places where its
 * context starts. A lesson with no prediction renders its body at once, as it
 * always did.
 *
 * What was guessed is kept for the life of the tab, by lesson, so going back
 * to a card in the deck shows it open rather than asking again.
 */

type Guess = { guess: string | null };

const guessed = new Map<string, Guess>();

/** Mark a lesson as already guessed, as the gallery draws the answered state. */
export function rememberPrediction(id: string, guess: string | null): void {
  guessed.set(id, { guess });
}

export function LessonPredict({
  id,
  predict,
  children,
}: {
  /** The lesson's card or concept, which the guess is kept under. */
  id: string;
  predict: Prediction | null | undefined;
  /** The lesson's body, given what was predicted and what is true to show where its context opens. */
  children: (outcome: ReactNode) => ReactNode;
}) {
  const [done, setDone] = useState<Guess | null>(() => guessed.get(id) ?? null);
  const [draft, setDraft] = useState('');
  const outcomeRef = useRef<HTMLDivElement>(null);
  const justOpened = useRef(false);
  const fieldId = useId();

  useEffect(() => {
    if (done && justOpened.current) {
      justOpened.current = false;
      outcomeRef.current?.focus({ preventScroll: true });
    }
  }, [done]);

  if (!predict) return <>{children(null)}</>;

  const finish = (guess: string | null) => {
    const next = { guess };
    guessed.set(id, next);
    justOpened.current = true;
    setDone(next);
  };

  if (!done) {
    const guess = draft.trim();
    return (
      <section className="mt-3 rounded-control border-l-2 border-accent bg-accent-tint px-3 py-2.5" data-lesson-predict>
        <h3 className="text-small font-semibold text-accent">Guess first</h3>
        <p className="mt-1 text-body font-medium text-ink">{predict.question}</p>
        <form
          className="mt-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (guess) finish(guess);
          }}
        >
          <Label htmlFor={fieldId} className="sr-only">
            Your guess
          </Label>
          <Textarea
            id={fieldId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && guess) {
                event.preventDefault();
                finish(guess);
              }
            }}
            placeholder="Your guess, in a few words"
            rows={2}
            className="w-full bg-surface"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={!guess}>
              See what is true
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => finish(null)}>
              Skip
            </Button>
            <span className="text-small text-ink-muted">Not marked. The lesson opens either way.</span>
          </div>
        </form>
      </section>
    );
  }

  const outcome = (
    <div
      ref={outcomeRef}
      tabIndex={-1}
      /* ui-ok: hand-rolled-box -- a panel inside the lesson card's body, the
       * sibling of the tinted takeaway panel, not a card of its own. A tint
       * read as a hole in the card in dark (plan #2522.6, critic round 1), so
       * it is set apart by a hairline instead. */
      className="mt-3 rounded-control border border-border px-3 py-2.5 outline-none"
      data-lesson-predicted
    >
      <p className="text-small text-ink-muted">{predict.question}</p>
      {/* The guess is the person's own words, drawn as a quote of them so
          it never reads as the lesson's (taste no-bare-text). */}
      {done.guess && (
        <figure className="mt-2">
          <figcaption className="text-small font-semibold text-ink-muted">Your guess</figcaption>
          <blockquote className="mt-0.5 border-l-2 border-border-strong pl-2.5 text-body text-ink-muted italic">
            {done.guess}
          </blockquote>
        </figure>
      )}
      <h4 className="mt-2 text-small font-semibold text-accent">{done.guess ? 'What is true' : 'The answer'}</h4>
      <p className="mt-0.5 text-body text-ink">{predict.answer}</p>
    </div>
  );
  return <>{children(outcome)}</>;
}
