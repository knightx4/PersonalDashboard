'use client';

import { useActionState } from 'react';
import { setItemsForSale, type ActionState } from '@/app/shopping/inventory/actions';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';

/**
 * The item's own "I want to sell this" switch.
 *
 * Deliberately not conditional on being a book or a game: the sell page routes
 * what it can price, and this is how everything else gets there.
 */
export function MarkForSaleButton({ itemId, forSale }: { itemId: string; forSale: boolean }) {
  const [state, action, pending] = useActionState(setItemsForSale, {} as ActionState);

  return (
    <form action={action} className="inline-flex flex-col items-end gap-1">
      <input type="hidden" name="id" value={itemId} />
      <input type="hidden" name="for_sale" value={forSale ? 'false' : 'true'} />
      <Button type="submit" variant={forSale ? 'secondary' : 'primary'} size="sm" disabled={pending}>
        {pending ? 'Saving…' : forSale ? 'Take off the sell page' : 'Mark for sale'}
      </Button>
      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-small text-positive">{state.message}</p>}
    </form>
  );
}
