'use client';

import { useActionState } from 'react';
import {
  confirmOrderReview,
  discardOrderReview,
  dismissEmailReview,
  type ActionState,
} from '@/app/shopping/review/actions';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';

const initial: ActionState = {};

export function ConfirmOrderButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(confirmOrderReview, initial);

  return (
    <form action={action} className="inline-flex flex-col items-stretch gap-1">
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Confirming…' : 'Looks right'}
      </Button>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

export function DiscardOrderButton({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState(discardOrderReview, initial);

  return (
    <form
      action={action}
      className="inline-flex flex-col items-stretch gap-1"
      onSubmit={(event) => {
        const ok = window.confirm(
          'Discard this order? It will be removed from Orders and Inventory, and the source email will be skipped on future imports.',
        );
        if (!ok) event.preventDefault();
      }}
    >
      <input type="hidden" name="orderId" value={orderId} />
      <Button type="submit" variant="danger" size="sm" disabled={pending}>
        {pending ? 'Discarding…' : 'Discard'}
      </Button>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

export function DismissEmailButton({ messageId }: { messageId: string }) {
  const [state, action, pending] = useActionState(dismissEmailReview, initial);

  return (
    <form action={action} className="inline-flex flex-col items-stretch gap-1">
      <input type="hidden" name="messageId" value={messageId} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? 'Dismissing…' : 'Not an order'}
      </Button>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}
