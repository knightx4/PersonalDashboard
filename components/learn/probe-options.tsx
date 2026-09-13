'use client';

import { useFormStatus } from 'react-dom';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';

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
        'hover:border-accent hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-70',
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
  /** Null until the question has been answered. */
  answered?: { correctIndex: number; chosenIndex: number } | null;
}) {
  return (
    <>
      {options.map((option, index) => (
        <div key={option} className="relative">
          <AnswerButton index={index} label={option} disabled={Boolean(answered)} />
          {answered && index === answered.correctIndex && (
            <Check
              className="absolute right-3 top-3.5 size-4 text-ink-muted"
              strokeWidth={2}
              aria-label="The correct answer"
            />
          )}
          {answered && index === answered.chosenIndex && index !== answered.correctIndex && (
            <X
              className="absolute right-3 top-3.5 size-4 text-danger"
              strokeWidth={2}
              aria-label="What you picked"
            />
          )}
        </div>
      ))}
    </>
  );
}
