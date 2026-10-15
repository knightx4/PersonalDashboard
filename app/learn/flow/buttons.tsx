'use client';

import { useFormStatus } from 'react-dom';
import { CloseButton } from '@/components/inbox/close-button';
import { Button } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';

/**
 * The presses Practice Flow's question cards share: Next, I don't know and
 * Later. Here rather than in `session.tsx` so the explain card (plan
 * #2164.2) draws the same ones in the same places.
 */

export function AskButton({
  label,
  variant,
  named = false,
}: {
  label: string;
  variant?: 'secondary';
  /**
   * Send `intent=ask` from the button itself, for a form whose other press
   * sends another intent (the explain card's follow-up, plan #2164.2).
   */
  named?: boolean;
}) {
  const { pending } = useFormStatus();
  // Usually the next question was written ahead and comes straight back. The
  // wait is only long when the queue ran dry and it is being written now.
  return (
    <DashAction
      type="submit"
      variant={variant}
      name={named ? 'intent' : undefined}
      value={named ? 'ask' : undefined}
      pending={pending}
      paid="app/learn/flow/actions.ts#flowStep:ask"
      what="Cost of the next question"
    >
      {pending ? 'Getting the next question…' : label}
    </DashAction>
  );
}

/**
 * "I don't know" (note a62b132f): a submit on the answer form carrying no
 * index. It counts as a miss, and the right answer and its reason come back
 * the same as after a wrong pick.
 */
export function DontKnowButton() {
  const { pending } = useFormStatus();
  return (
    <DashAction
      variant="link"
      type="submit"
      name="dontKnow"
      value="1"
      pending={pending}
      paid="app/learn/flow/actions.ts#flowStep:answer"
      what="Cost of answering"
    >
      I don&rsquo;t know
    </DashAction>
  );
}

/**
 * Later (note 7ccc6f99, plan #1957.3): the question goes back to the end of
 * the queue with nothing recorded against it, and the next one comes up, so
 * there is nothing for an Undo to take back. On the answer form so it sits
 * beside I don't know, and told apart by its own field.
 */
export function NotNowButton() {
  const { pending } = useFormStatus();
  return (
    <CloseButton
      lifecycle="later"
      variant="link"
      type="submit"
      name="notNow"
      value="1"
      pending={pending}
    />
  );
}

/**
 * End here (plan #2164.6): stops the run and shows what it moved. Reads the
 * stored answers and calls no model, so it is a plain button.
 */
export function EndHereButton({ onEnd }: { onEnd: () => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onEnd}>
      End here
    </Button>
  );
}
