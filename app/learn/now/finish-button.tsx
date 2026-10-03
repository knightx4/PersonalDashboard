'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { completionMoment } from '@/components/motion/complete';
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
  const [state, formAction] = useActionState<ReadingActionState, FormData>(finish, {});

  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="readingId" value={readingId} />
      <input type="hidden" name="status" value="read" />
      <Submit />
      {state.error && <span className="text-small text-danger">{state.error}</span>}
    </form>
  );
}

/** Mark it read, and play the completion moment when that went through. */
async function finish(previous: ReadingActionState, form: FormData): Promise<ReadingActionState> {
  const state = await updateStatus(previous, form);
  if (!state.error) completionMoment();
  return state;
}

function Submit() {
  const { pending } = useFormStatus();

  // The shared button, not a fourth drawing of one: this was a hand-typed
  // control frame at a hand-typed height, which is a button that agrees with
  // nothing beside it at any density.
  return (
    <Button type="submit" variant="secondary" pending={pending}>
      <Check className="size-3.5" strokeWidth={2} aria-hidden />
      {pending ? 'Marking…' : 'Read it'}
    </Button>
  );
}
