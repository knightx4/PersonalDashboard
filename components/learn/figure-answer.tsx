import { Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import type { FigureQuestionView } from '@/lib/learn/figures/question';
import { Figure, FigureBody } from './figure';

/**
 * A figure question's figure and its answer control (plan #2321.5): the
 * figure open on every width, then the choices to pick from, or a short box
 * for a typed answer. Both post `response`, as the explanation's box does,
 * so the same action grades all three.
 *
 * A choice is a whole row to press, with the radio at its start; a pick of a
 * diagram draws each option under its letter.
 */
export function FigureAnswer({
  questionId,
  question,
  answered,
  pending,
  defaultValue,
  describedBy,
}: {
  questionId: string;
  question: FigureQuestionView;
  /** Once graded the figure shows and nothing is asked. */
  answered?: boolean;
  pending?: boolean;
  /** What was sent before an error, so it is still chosen or typed. */
  defaultValue?: string;
  describedBy?: string;
}) {
  return (
    <>
      <Figure figure={question.figure} unfolded />
      {answered ? null : question.choices ? (
        <fieldset className="mt-4 space-y-2" aria-describedby={describedBy}>
          <legend className="sr-only">Your answer</legend>
          {question.choices.map((choice) => (
            <label
              key={choice.value}
              className={cn(
                // ui-ok: hand-rolled-box -- an answer option's own frame, as
                // in components/learn/probe-options: the edge is the option.
                'flex cursor-pointer items-start gap-3 rounded-control border border-border px-4 py-3',
                'hover:bg-accent-tint has-checked:border-accent has-checked:bg-accent-tint',
                pending && 'cursor-not-allowed opacity-70',
              )}
            >
              <input
                type="radio"
                name="response"
                value={choice.value}
                required
                disabled={pending}
                defaultChecked={defaultValue === choice.value}
                className="mt-1 size-4 shrink-0 accent-accent"
              />
              <div className="min-w-0 flex-1">
                <span className="block text-body text-ink">{choice.label}</span>
                {choice.figure && (
                  <div className="mt-2">
                    <FigureBody figure={choice.figure} />
                  </div>
                )}
              </div>
            </label>
          ))}
        </fieldset>
      ) : (
        <>
          <label htmlFor={`answer-${questionId}`} className="sr-only">
            Your answer
          </label>
          <Input
            id={`answer-${questionId}`}
            name="response"
            defaultValue={defaultValue ?? ''}
            readOnly={pending}
            autoComplete="off"
            placeholder="What goes in the blank"
            // A press target on a phone is 44px at the least.
            className={cn('mt-4 h-11 text-body', pending && 'text-ink-muted')}
            aria-describedby={describedBy}
            required
          />
        </>
      )}
    </>
  );
}
