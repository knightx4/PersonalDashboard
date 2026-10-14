'use client';

import { useFormStatus } from 'react-dom';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The options of one probe question, and the marks after it is answered.
 *
 * Shared by the subject session and the five-minute one so an answer looks the
 * same wherever it was asked. Every option is a submit button carrying its own
 * index, which is why there is no radio group here: picking an answer is the
 * submit.
 */

function AnswerButton({
  index,
  label,
  disabled,
}: {
  index: number;
  label: string;
  disabled: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="chosenIndex"
      value={index}
      disabled={pending || disabled}
      className={cn(
        // ui-ok: hand-rolled-box -- a control's own frame, not a frame around
        // a group. Law 11 is about a border standing in for space, alignment
        // or a ground; the edge of an answer option is the option. The shared
        // Button does not fit: this is full width, left aligned, and wraps to
        // as many lines as the answer needs, where Button is centred on one
        // line at the dial's height. Same call as components/todo/task-form.
        'w-full rounded-control border border-border px-4 py-3 text-left text-body text-ink',
        'hover:bg-accent-tint disabled:cursor-not-allowed disabled:opacity-70',
      )}
    >
      {label}
    </button>
  );
}

export function ProbeOptions({
  options,
  answered,
}: {
  options: string[];
  /**
   * Null until the question has been answered. The indexes are absent on an
   * answer that was typed rather than picked, which this never marks: it is
   * the multiple-choice rung's own control.
   */
  answered?: { correctIndex?: number; chosenIndex?: number } | null;
}) {
  return (
    <>
      {options.map((option, index) => (
        <div key={option} className="relative">
          <AnswerButton index={index} label={option} disabled={Boolean(answered)} />
          {answered && index === answered.correctIndex && (
            <Tooltip label="The correct answer" align="end" className="absolute right-3 top-3.5">
              <span tabIndex={0} role="img" aria-label="The correct answer" className="inline-flex">
                <Check className="size-4 text-ink-muted" strokeWidth={1.75} aria-hidden />
              </span>
            </Tooltip>
          )}
          {answered && index === answered.chosenIndex && index !== answered.correctIndex && (
            <Tooltip label="What you picked" align="end" className="absolute right-3 top-3.5">
              <span tabIndex={0} role="img" aria-label="What you picked" className="inline-flex">
                <X className="size-4 text-danger" strokeWidth={1.75} aria-hidden />
              </span>
            </Tooltip>
          )}
        </div>
      ))}
    </>
  );
}
