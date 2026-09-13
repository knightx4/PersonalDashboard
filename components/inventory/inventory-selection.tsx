'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  deleteInventoryItems,
  setItemsForSale,
  type ActionState,
} from '@/app/shopping/inventory/actions';
import { groupItemsTogether } from '@/app/shopping/inventory/group-actions';
import { setItemsReturnPlanned } from '@/app/shopping/returns/actions';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { SelectionActionBar, useSelection } from '@/components/ui/selection';
import { useToast } from '@/components/ui/toast';

/**
 * What to do with the selected items.
 *
 * The selection itself is the shared one now — the set, the ranges, the
 * keyboard and the tick box all come from components/ui/selection.tsx, and this
 * is only the verbs. They are the list's own: marking for sale, marking to
 * return, merging two copies of one thing, and deleting, which is the one that
 * asks twice.
 *
 * Rendered through the page header's bulk slot, so it takes the heading's place
 * rather than sitting above the list as its own strip.
 */
export function InventoryBulkBar({ total }: { total: number }) {
  const selection = useSelection();
  const toast = useToast();
  const [saleState, saleAction, salePending] = useActionState(setItemsForSale, {} as ActionState);
  const [returnState, returnAction, returnPending] = useActionState(
    setItemsReturnPlanned,
    {} as ActionState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteInventoryItems,
    {} as ActionState,
  );
  const [groupState, groupAction, groupPending] = useActionState(
    groupItemsTogether,
    {} as ActionState,
  );
  // Deleting a shelf-full cannot be undone, so it is asked twice — inline
  // rather than through window.confirm, which browsers are free to suppress.
  // Armed against the exact items it was pressed for, so a selection that
  // changed between the two presses disarms rather than quietly widening what
  // gets deleted — and so an armed confirm cannot survive into a later one.
  const [armedFor, setArmedFor] = useState('');

  // A delete empties the selection, which takes the bar off the header with it,
  // so what it says goes to the toast instead of into a bar that is leaving.
  const deleted = deleteState.message;
  useEffect(() => {
    if (deleted) toast({ text: deleted });
  }, [deleted, toast]);

  // The provider drops ids the server no longer lists, so this is already only
  // rows that are still there.
  const ids = selection ? [...selection.ids] : [];
  const pending = salePending || returnPending || deletePending || groupPending;
  const armKey = ids.join(',');
  const confirmingDelete = ids.length > 0 && armedFor === armKey;
  const hidden = ids.map((id) => <input key={id} type="hidden" name="id" value={id} />);

  return (
    <SelectionActionBar>
      <form action={saleAction} className="contents">
        {hidden}
        <input type="hidden" name="for_sale" value="true" />
        <Button type="submit" size="sm" disabled={pending}>
          Mark for sale
        </Button>
      </form>

      <form action={saleAction} className="contents">
        {hidden}
        <input type="hidden" name="for_sale" value="false" />
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          Not for sale
        </Button>
      </form>

      <form action={returnAction} className="contents">
        {hidden}
        <input type="hidden" name="planned" value="true" />
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          Mark to return
        </Button>
      </form>

      <form action={returnAction} className="contents">
        {hidden}
        <input type="hidden" name="planned" value="false" />
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          Not returning
        </Button>
      </form>

      {/* Only ever a merge: two copies of one thing the derived key kept
          apart. Splitting one back out is on the item's own page, where the
          copies are listed and you can see which one you mean. */}
      {ids.length > 1 && (
        <form action={groupAction} className="contents">
          {hidden}
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            {groupPending ? 'Grouping…' : 'Group as one item'}
          </Button>
        </form>
      )}

      {confirmingDelete ? (
        <>
          <span className="text-ui text-ink">This cannot be undone.</span>
          <form action={deleteAction} className="contents">
            {hidden}
            <Button type="submit" size="sm" variant="danger" disabled={pending}>
              {deletePending ? 'Deleting…' : `Delete ${ids.length} permanently`}
            </Button>
          </form>
          <Button type="button" size="sm" variant="ghost" onClick={() => setArmedFor('')}>
            Cancel
          </Button>
        </>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => setArmedFor(armKey)}
        >
          Delete
        </Button>
      )}

      {selection && selection.count < total && (
        <Button type="button" size="sm" variant="ghost" onClick={selection.selectAll}>
          Select all {total}
        </Button>
      )}

      {(saleState.message || returnState.message || groupState.message) && (
        <span className="text-ui text-positive">
          {saleState.message ?? returnState.message ?? groupState.message}
        </span>
      )}
      <FieldError>
        {saleState.error ?? returnState.error ?? deleteState.error ?? groupState.error}
      </FieldError>
    </SelectionActionBar>
  );
}
