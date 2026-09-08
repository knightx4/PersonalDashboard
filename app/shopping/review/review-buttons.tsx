'use client';

import { useActionState } from 'react';
import {
  confirmOrderReview,
  discardOrderReview,
  dismissEmailReview,
  type ActionState,
} from '@/app/shopping/review/actions';
import { Button } from '@/components/ui/button';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { FieldError } from '@/components/ui/field';

const initial: ActionState = {};

export function ConfirmOrderButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(confirmOrderReview, initial);

  return (
    <form action={action} className="inline-flex flex-col items-stretch gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" size="sm" pending={pending}>
        {pending ? 'Confirming…' : 'Looks right'}
      </Button>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

/**
 * Discarding also mutes the source email, so there is no undo: this is the one
 * button on the page that confirms, and it does so in place.
 */
export function DiscardOrderButton({ orderId }: { orderId: string }) {
  return (
    <ConfirmStep
      variant="danger"
      size="sm"
      prompt="It will be removed from Orders and Inventory, and the source email will be skipped on future imports."
      confirmLabel="Discard"
      pendingLabel="Discarding…"
      // The action is written for useActionState, so it takes the previous
      // state first; ConfirmStep only reads `ok`/`error`, so map the shape.
      action={async (formData) => {
        const result = await discardOrderReview(initial, formData);
        return result.error ? { ok: false, error: result.error } : { ok: true };
      }}
      fields={{ orderId }}
    >
      Discard
    </ConfirmStep>
  );
}

export function DismissEmailButton({ messageId }: { messageId: string }) {
  const [state, action, pending] = useActionState(dismissEmailReview, initial);

  return (
    <form action={action} className="inline-flex flex-col items-stretch gap-1">
      <input type="hidden" name="messageId" value={messageId} />
      <Button type="submit" variant="secondary" size="sm" pending={pending}>
        {pending ? 'Dismissing…' : 'Not an order'}
      </Button>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}
