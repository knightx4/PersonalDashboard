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

const initial: ActionState = {};

export function PlanReturnButton({
  itemId,
  planned,
}: {
  itemId: string;
  planned: boolean;
}) {
  const [state, action, pending] = useActionState(setReturnPlanned, initial);

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={itemId} />
      <input type="hidden" name="planned" value={planned ? 'false' : 'true'} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? 'Saving…' : planned ? 'Unmark to return' : 'Mark to return'}
      </Button>
      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-small text-positive">{state.message}</p>}
    </form>
  );
}

export function MarkReturnedButton({ itemId }: { itemId: string }) {
  const [state, action, pending] = useActionState(markItemReturned, initial);

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={itemId} />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? 'Saving…' : 'Returned'}
      </Button>
      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-small text-positive">{state.message}</p>}
    </form>
  );
}

export function UndoReturnedButton({
  itemId,
  returnId,
}: {
  itemId: string;
  returnId: string;
}) {
  const [state, action, pending] = useActionState(undoItemReturned, initial);

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={itemId} />
      <input type="hidden" name="return_id" value={returnId} />
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {pending ? 'Restoring…' : 'Undo return'}
      </Button>
      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-small text-positive">{state.message}</p>}
    </form>
  );
}
