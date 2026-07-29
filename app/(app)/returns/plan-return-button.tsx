'use client';

import { useActionState } from 'react';
import { setReturnPlanned, type ActionState } from '@/app/(app)/returns/actions';
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
      {state.message && <p className="text-[12px] text-positive">{state.message}</p>}
    </form>
  );
}
