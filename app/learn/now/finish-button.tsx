'use client';

import { useActionState, useRef } from 'react';
import { useFormStatus } from 'react-dom';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { completionMoment } from '@/components/motion/complete';
import { putAway } from '@/components/motion/place';
import { updateStatus, type ReadingActionState } from '../r/[id]/actions';

/**
 * The one write this page needs.
 *
 * Marking it read is also what takes it off the shelf -- see setReadingStatus
 * -- so the row leaves the page on its own and nothing has to be tidied by
 * hand. "Gave up" is not offered here: it is a real and useful answer, and it
 * is a decision, which is exactly what this tab exists not to ask for. It is
 * one click away on the reading's own page.
 *
 * Once it is marked, the reading is shown going to its reading list (plan
 * #1578), which is where it now lives: Reading lists, named with the list.
 */
export function FinishButton({
  readingId,
  subject,
  list,
}: {
  readingId: string;
  /** The reading's subject, which the chip carries. */
  subject: string;
  /** The reading list it belongs to, named where it lands. */
  list: string;
}) {
  const form = useRef<HTMLFormElement>(null);

  /** Mark it read, then play the completion moment and the trip to its list. */
  async function finish(previous: ReadingActionState, data: FormData): Promise<ReadingActionState> {
    // Taken before the write: the row leaves the shelf when the page comes back.
    const from = form.current?.getBoundingClientRect();
    const state = await updateStatus(previous, data);
    if (!state.error) {
      completionMoment();
      void putAway({ from, href: '/learn/lists', label: subject, name: `Reading lists · ${list}` });
    }
    return state;
  }

  const [state, formAction] = useActionState<ReadingActionState, FormData>(finish, {});

  return (
    <form ref={form} action={formAction} className="inline-flex items-center gap-2">
      <input type="hidden" name="readingId" value={readingId} />
      <input type="hidden" name="status" value="read" />
      <Submit />
      {state.error && <span className="text-small text-danger">{state.error}</span>}
    </form>
  );
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
