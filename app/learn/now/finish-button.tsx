'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';
import { updateStatus, type ReadingActionState } from '../r/[id]/actions';

/**
 * The one write this page needs.
 *
 * Marking it read is also what takes it off the shelf -- see setReadingStatus
 * -- so the row leaves the page on its own and nothing has to be tidied by
 * hand. "Gave up" is not offered here: it is a real and useful answer, and it
 * is a decision, which is exactly what this tab exists not to ask for. It is
 * one click away on the reading's own page.
 */
export function FinishButton({ readingId }: { readingId: string }) {
  const [state, formAction] = useActionState<ReadingActionState, FormData>(updateStatus, {});

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="readingId" value={readingId} />
      <input type="hidden" name="status" value="read" />
      <Submit />
      {state.error && <span className="text-small text-danger">{state.error}</span>}
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        'press inline-flex items-center gap-1.5 rounded-lg border border-control bg-surface px-3 py-1.5 text-ui text-ink',
        'transition-colors duration-150 hover:bg-sunken focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:opacity-50',
      )}
    >
      <Check className="size-3.5" strokeWidth={2} aria-hidden />
      {pending ? 'Marking…' : 'Read it'}
    </button>
  );
}
