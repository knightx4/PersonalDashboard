'use client';

import { useActionState } from 'react';
import {
  markItemReturned,
  setReturnPlanned,
  undoItemReturned,
  type ActionState,
} from '@/app/shopping/returns/actions';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';

const initial: ActionState = {};

function formOf(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
}

/**
 * Every button here is reversible, so none of them confirms: it does the thing
 * and says so in a toast, with the way back beside it. The inverse action is
 * called with the same shape the form would have sent, so the undo cannot
 * drift from the button that does it by hand. Errors still land under the
 * button, where the person is looking.
 */
export function PlanReturnButton({
  itemId,
  planned,
}: {
  itemId: string;
  planned: boolean;
}) {
  const toast = useToast();
  const [state, action, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const next = await setReturnPlanned(prev, formData);
    if (!next.error) {
      toast({
        text: planned ? 'Unmarked to return' : 'Marked to return',
        undo: async () => {
          const undone = await setReturnPlanned(
            initial,
            formOf({ id: itemId, planned: planned ? 'true' : 'false' }),
          );
          if (undone.error) throw new Error(undone.error);
        },
      });
    }
    return next;
  }, initial);

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={itemId} />
      <input type="hidden" name="planned" value={planned ? 'false' : 'true'} />
      <Button type="submit" variant="secondary" size="sm" pending={pending}>
        {pending ? 'Saving…' : planned ? 'Unmark to return' : 'Mark to return'}
      </Button>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

export function MarkReturnedButton({ itemId }: { itemId: string }) {
  const toast = useToast();
  const [state, action, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const next = await markItemReturned(prev, formData);
    if (!next.error) {
      const returnId = next.returnId;
      toast({
        text: 'Marked as returned',
        undone: 'back in inventory',
        undo: returnId
          ? async () => {
              const undone = await undoItemReturned(
                initial,
                formOf({ id: itemId, return_id: returnId }),
              );
              if (undone.error) throw new Error(undone.error);
            }
          : undefined,
      });
    }
    return next;
  }, initial);

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={itemId} />
      <Button type="submit" size="sm" pending={pending}>
        {pending ? 'Saving…' : 'Returned'}
      </Button>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

/**
 * Stays as a button on the row rather than only living in a toast: a toast is
 * gone in six seconds and a return marked yesterday still needs a way back.
 */
export function UndoReturnedButton({
  itemId,
  returnId,
}: {
  itemId: string;
  returnId: string;
}) {
  const toast = useToast();
  const [state, action, pending] = useActionState(async (prev: ActionState, formData: FormData) => {
    const next = await undoItemReturned(prev, formData);
    if (!next.error) toast({ text: 'Restored to inventory' });
    return next;
  }, initial);

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={itemId} />
      <input type="hidden" name="return_id" value={returnId} />
      <Button type="submit" variant="secondary" size="sm" pending={pending}>
        {pending ? 'Restoring…' : 'Undo return'}
      </Button>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}
