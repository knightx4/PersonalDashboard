'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { BookOpen } from 'lucide-react';
import { cn } from '@/lib/cn';
import { toggleReadNow, type ReadingActionState } from './actions';

/**
 * Put this on the shelf, or take it off.
 *
 * One button rather than a place in the status row: where you are with a
 * reading and whether you mean to read it next are different facts, and a
 * fifth status would have made "Read now" mutually exclusive with "Reading",
 * which is the one combination that happens most.
 */
export function ReadNowButton({ readingId, on }: { readingId: string; on: boolean }) {
  const [state, formAction] = useActionState<ReadingActionState, FormData>(toggleReadNow, {});

  return (
    <form action={formAction} className="inline-flex flex-col items-start gap-1">
      <input type="hidden" name="readingId" value={readingId} />
      <input type="hidden" name="on" value={on ? 'off' : 'on'} />
      <Submit on={on} />
      {state.error && <p className="text-ui text-danger">{state.error}</p>}
    </form>
  );
}

function Submit({ on }: { on: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-pressed={on}
      className={cn(
        'press inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-ui transition-colors duration-150',
        'focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50',
        on
          ? 'border-accent bg-accent-tint font-medium text-accent'
          : 'border-control bg-surface text-ink hover:bg-sunken',
      )}
    >
      <BookOpen className="size-3.5" strokeWidth={1.75} aria-hidden />
      {on ? 'On Read now' : 'Read now'}
    </button>
  );
}
