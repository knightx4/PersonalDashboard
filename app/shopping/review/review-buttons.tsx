'use client';

import { useActionState, useState, useTransition } from 'react';
import { CloseButton } from '@/components/inbox/close-button';
import { useToast } from '@/components/ui/toast';
import { Tooltip } from '@/components/ui/tooltip';
import {
  confirmOrderReview,
  discardOrderReview,
  dismissEmailsReview,
  excludeSenderReview,
  restoreDismissedEmails,
  type ActionState,
} from '@/app/shopping/review/actions';
import { chooseExclusionDomain } from '@/lib/review/exclude-sender';
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

/** Not an order: Decline the sync's guess, with Undo in the toast (plan #1957.3). */
export function DismissEmailButton({ messageId }: { messageId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();

  return (
    <span className="inline-flex flex-col items-stretch gap-1">
      <Tooltip label="Not an order">
        <CloseButton
          lifecycle="declined"
          variant="secondary"
          pending={pending}
          onClick={() =>
            start(async () => {
              const result = await dismissEmailsReview([messageId]);
              setError(result.error ?? null);
              if (result.error) return;
              const restore = result.restore;
              toast({
                text: 'Declined: not an order',
                undo: async () => {
                  const back = await restoreDismissedEmails(restore);
                  if (back.error) throw new Error(back.error);
                },
              });
            })
          }
        />
      </Tooltip>
      <FieldError>{error}</FieldError>
    </span>
  );
}

/**
 * Mute the email's sender domain, or its exact address when it is a personal
 * mailbox such as gmail.com. There is no undo toast, because the mute is
 * undone from Muted merchants in shopping settings, so it confirms in place
 * and says where. A sender whose domain many shops share gets the server's
 * refusal and its reason rather than a confirm.
 */
export function ExcludeSenderButton({
  messageId,
  fromAddress,
  replyToAddress,
}: {
  messageId: string;
  fromAddress: string | null;
  replyToAddress: string | null;
}) {
  const [state, action, pending] = useActionState(excludeSenderReview, initial);
  const choice = chooseExclusionDomain({ fromAddress, replyToAddress });

  if (!choice.ok) {
    return (
      <form action={action} className="inline-flex flex-col items-stretch gap-1">
        <input type="hidden" name="messageId" value={messageId} />
        <Button type="submit" variant="ghost" size="sm" pending={pending}>
          Exclude sender
        </Button>
        <FieldError>{state.error}</FieldError>
      </form>
    );
  }

  return (
    <ConfirmStep
      variant="ghost"
      size="sm"
      prompt={`Every waiting email from ${choice.domain} leaves the queue, and later mail from it is skipped. You can undo this under Muted merchants in shopping settings.`}
      confirmLabel={`Exclude ${choice.domain}`}
      pendingLabel="Excluding…"
      action={async (formData) => {
        const result = await excludeSenderReview(initial, formData);
        return result.error ? { ok: false, error: result.error } : { ok: true };
      }}
      fields={{ messageId }}
    >
      Exclude sender
    </ConfirmStep>
  );
}
