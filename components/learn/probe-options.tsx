'use client';

import { useFormStatus } from 'react-dom';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The options of one probe question, and the marks after it is answered.
 *
 * A choice is a whole row to press, with the radio at its start, as a
 * Practice figure question's is. Picking no longer sends the answer (plan
 * #2522.2): how sure you are and how you got there sit under the options,
 * and Check my answer sends all three. The radios post `chosenIndex`.
 */

// ui-ok: hand-rolled-box -- a control's own frame, not a frame around a group.
// Law 11 is about a border standing in for space, alignment or a ground; the
// edge of an answer option is the option. Same call as figure-answer.tsx.
const ROW = 'flex items-start gap-3 rounded-control border border-border px-4 py-3 text-body text-ink';

export function ProbeOptions({
  options,
  answered,
  defaultIndex,
}: {
  options: string[];
  /**
   * Null until the question has been answered. The indexes are absent on an
   * answer that was typed rather than picked, which this never marks: it is
   * the multiple-choice rung's own control.
   */
  answered?: { correctIndex?: number; chosenIndex?: number } | null;
  /** Chosen before an error, so the pick is still there to send again. */
  defaultIndex?: number;
}) {
  const { pending } = useFormStatus();

  if (answered) {
    return (
      <div className="space-y-2">
        {options.map((option, index) => (
          <div
            key={option}
            className={cn(ROW, 'relative pr-10', index === answered.chosenIndex && 'border-control bg-sunken')}
          >
            <span className="min-w-0 flex-1">{option}</span>
            {index === answered.correctIndex && (
              <Tooltip label="The correct answer" align="end" className="absolute right-3 top-3.5">
                <span tabIndex={0} role="img" aria-label="The correct answer" className="inline-flex">
                  <Check className="size-4 text-ink-muted" strokeWidth={1.75} aria-hidden />
                </span>
              </Tooltip>
            )}
            {index === answered.chosenIndex && index !== answered.correctIndex && (
              <Tooltip label="What you picked" align="end" className="absolute right-3 top-3.5">
                <span tabIndex={0} role="img" aria-label="What you picked" className="inline-flex">
                  <X className="size-4 text-danger" strokeWidth={1.75} aria-hidden />
                </span>
              </Tooltip>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">Your answer</legend>
      {options.map((option, index) => (
        <label
          key={option}
          className={cn(
            ROW,
            'cursor-pointer hover:bg-accent-tint has-checked:border-accent has-checked:bg-accent-tint',
            pending && 'cursor-not-allowed opacity-70',
          )}
        >
          <input
            type="radio"
            name="chosenIndex"
            value={index}
            required
            disabled={pending}
            defaultChecked={defaultIndex === index}
            className="mt-1 size-4 shrink-0 accent-accent"
          />
          <span className="min-w-0 flex-1">{option}</span>
        </label>
      ))}
    </fieldset>
  );
}
