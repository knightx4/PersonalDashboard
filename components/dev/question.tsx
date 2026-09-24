'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { FieldError, FieldHint, Label, Textarea } from '@/components/ui/field';
import { optionAnswer, planOptions, recommendedLetter, type PlanOption } from '@/lib/plan/options';

/**
 * A question put to you, wherever it is read.
 *
 * All of this was written inside the plan page, which is the only place a
 * question could be answered: the question set apart, the lettered options as
 * buttons that fill the answer in, and the box you type in. Dash lists the
 * same questions and used to send you to the plan page to find the row before
 * you could say anything, so the three pieces live here now and both pages
 * draw them. One mechanism, so the two cannot drift into answering the same
 * question differently.
 *
 * Nothing here talks to the database. The caller owns the action state --
 * `answerPlanDecision` on both pages -- because the plan page reports what
 * came back once for the whole row rather than under each control.
 */

/**
 * Three words in the same small caps in every place a question is shown, so
 * that "which of these am I reading" is answered by the shape of the thing and
 * not by working it out from the prose.
 */
export function QuestionPartLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-micro font-semibold uppercase tracking-wide text-ink-muted">{children}</p>
  );
}

/**
 * The question itself, said once and set apart.
 *
 * A question used to be a line of body text among the step's other lines, at
 * the same size and weight as the description of the work -- so the one thing
 * on the surface that is actually waiting on a person looked like reading
 * matter. It is now labelled and set a step up the scale, which is the whole
 * ask: when something needs an answer, the question I am answering should be
 * the clearest thing on the surface.
 */
export function TheQuestion({ outline, title }: { outline: string; title: string }) {
  return (
    <div className="space-y-0.5">
      <QuestionPartLabel>The question</QuestionPartLabel>
      <p className="text-ui font-medium text-ink">
        <span className="tabular mr-1.5 font-normal text-small text-ink-ghost">#{outline}</span>
        {title}
      </p>
    </div>
  );
}

/**
 * The options, as options.
 *
 * They are written as prose in `detail` -- a lettered paragraph each, with
 * what it costs and a recommendation -- and were shown as that same paragraph:
 * a muted block of text in which the choices had to be found by reading. Where
 * the letters are legible (see lib/plan/options.ts) each one now gets its own
 * line and its letter in a badge, so the shape of the choice is visible before
 * a word of it is read.
 *
 * `onChoose` makes each line the button that answers with it. Without it they
 * are just the options, which is what they are while nobody is answering.
 *
 * The prose does not disappear: the letters carry only each option's opening
 * sentence, and the cost and the recommendation are the rest of the paragraph.
 * That goes under the fold, where it can be read by anybody who wants more than
 * the choice -- law 10, and the collapsed line says what is behind it.
 */
export function TheOptions({
  detail,
  onChoose,
}: {
  detail: string | null;
  onChoose?: (option: PlanOption) => void;
}) {
  if (!detail) return null;
  const options = planOptions(detail);
  // The letter the prose recommends wears a green ring, so the choice a
  // session would make shows before its paragraph is read (note 3a57b12f).
  const recommended = recommendedLetter(detail, options);

  if (options.length === 0) {
    return (
      <div className="space-y-0.5">
        <QuestionPartLabel>The options</QuestionPartLabel>
        <p className="whitespace-pre-wrap text-small text-ink-muted">{detail}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <QuestionPartLabel>The options</QuestionPartLabel>
      <ul className="space-y-1">
        {options.map((option) => {
          const isRecommended = option.letter === recommended;
          const body = (
            <>
              <span
                aria-hidden
                className={
                  'flex size-5 shrink-0 items-center justify-center rounded-control text-micro font-semibold uppercase ' +
                  (isRecommended
                    ? 'bg-positive-tint text-positive ring-1 ring-positive shadow-[0_0_6px_var(--color-positive)]'
                    : 'bg-surface text-ink')
                }
              >
                {option.letter}
              </span>
              <span className="min-w-0 flex-1 text-left text-small text-ink">
                {option.label}
                {isRecommended && <span className="sr-only"> (recommended)</span>}
              </span>
            </>
          );

          return (
            <li key={option.letter}>
              {onChoose ? (
                <button
                  type="button"
                  onClick={() => onChoose(option)}
                  title={`Answer ${option.letter}: ${option.label}${isRecommended ? ' (recommended)' : ''}`}
                  className="press flex w-full items-start gap-2 rounded-control px-1.5 py-1 transition-colors duration-150 hover:bg-accent-tint"
                >
                  {body}
                </button>
              ) : (
                <span className="flex items-start gap-2 px-1.5 py-1">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
      <Disclosure title="What each one costs" className="px-1.5">
        <p className="whitespace-pre-wrap text-small text-ink-muted">{detail}</p>
      </Disclosure>
    </div>
  );
}

/**
 * An answer already recorded, on a question that was answered and left open.
 * Changing your mind is a fresh answer rather than an edit, so this stays
 * above the box rather than in it.
 */
export function TheAnswered({ resolution }: { resolution: string }) {
  return (
    <div className="space-y-0.5">
      <QuestionPartLabel>Answered</QuestionPartLabel>
      <p className="whitespace-pre-wrap text-ui text-ink">{resolution}</p>
    </div>
  );
}

/**
 * The draft answer, shared between the options and the box.
 *
 * Pressing an option writes it into the box rather than recording it: an
 * answer is read by every session that works beneath the question from then
 * on, so the last word before it is written down stays the person's, and "b,
 * but only for the shared lists" is the answer they most often actually want.
 * Replaces rather than appends -- pressing two of them means you changed your
 * mind, not that you want both written down -- and what was typed after it is
 * left alone.
 *
 * Controlled, not written through a ref. A ref put the text into the DOM node
 * behind React's back, which worked only where the box happens to always be
 * mounted; where it is opened by the press there is nothing to write to yet,
 * which is why the options in the plan page's questions list once did nothing
 * at all. `onChosen` is what opens the box in those places.
 */
export function useAnswerDraft(onChosen?: () => void) {
  const [answer, setAnswer] = useState('');

  return {
    answer,
    setAnswer,
    choose: (option: PlanOption) => {
      setAnswer(optionAnswer(option));
      onChosen?.();
    },
  };
}

/**
 * The box a question closes in.
 *
 * `answer` and `onAnswer` come from `useAnswerDraft` above, so that pressing an
 * option and typing are the same field. `onCancel` is offered where the box was
 * opened by a press and can be closed again; `hint` where there is room to say
 * what pressing Answer does.
 */
export function AnswerBox({
  id,
  detail,
  resolution,
  action,
  pending,
  answer,
  onAnswer,
  autoFocus = false,
  onCancel,
  hint = false,
  error,
}: {
  id: string;
  detail: string | null;
  resolution: string | null;
  action: (formData: FormData) => void;
  pending: boolean;
  answer: string;
  onAnswer: (answer: string) => void;
  autoFocus?: boolean;
  onCancel?: () => void;
  hint?: boolean;
  error?: string;
}) {
  const field = `answer-${id}`;
  const options = planOptions(detail);

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={id} />
      <Label htmlFor={field}>{resolution ? 'Change the answer' : 'Your answer'}</Label>
      <Textarea
        id={field}
        name="answer"
        rows={2}
        className="min-h-12"
        autoFocus={autoFocus}
        value={answer}
        onChange={(event) => onAnswer(event.target.value)}
        placeholder={
          options.length > 0
            ? 'Pick one above, or say it in your own words — and enough of why that a session need not ask again.'
            : 'What you decided, and enough of why that a session need not ask again.'
        }
      />
      {hint && <FieldHint>This closes the question. Nothing is committed against it.</FieldHint>}
      <div className="flex flex-wrap items-center gap-1">
        <Button type="submit" size="sm" pending={pending}>
          {resolution ? 'Record the new answer' : 'Answer'}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <FieldError>{error}</FieldError>
      </div>
    </form>
  );
}
