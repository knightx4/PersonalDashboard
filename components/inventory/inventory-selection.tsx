'use client';

import {
  createContext,
  useActionState,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  deleteInventoryItems,
  setItemsForSale,
  type ActionState,
} from '@/app/shopping/inventory/actions';
import { groupItemsTogether } from '@/app/shopping/inventory/group-actions';
import { setItemsReturnPlanned } from '@/app/shopping/returns/actions';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';

type Selection = {
  selected: ReadonlySet<string>;
  /**
   * Ticks or unticks a whole row's worth of copies at once. A row can stand
   * for three physical units, and "mark for sale" said to it means all three,
   * so the set holds unit ids and a row contributes all of its own.
   */
  toggle: (ids: readonly string[]) => void;
  selectAll: (ids: string[]) => void;
  clear: () => void;
};

const SelectionContext = createContext<Selection | null>(null);

/**
 * Multi-select over the inventory list.
 *
 * Row actions handle one item well and one item only, which is fine until the
 * answer to "which of these am I selling?" is fifteen of them. Selection lives
 * here rather than in the rows so the action bar can see the whole set, and so
 * a page with no bar renders rows with no checkboxes at all.
 */
export function InventorySelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const toggle = useCallback((ids: readonly string[]) => {
    setSelected((current) => {
      const next = new Set(current);
      // The row is ticked when every one of its copies is; toggling clears all
      // of them or adds all of them, never leaves a row half-selected.
      const allSelected = ids.length > 0 && ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids));
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo(
    () => ({ selected, toggle, selectAll, clear }),
    [selected, toggle, selectAll, clear],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/** Null outside a provider, so a row can render on a page with no selection. */
export function useInventorySelection(): Selection | null {
  return useContext(SelectionContext);
}

export function InventoryRowCheckbox({
  id,
  ids,
  label,
}: {
  id: string;
  /** Every copy this row stands for. Defaults to the row's own id. */
  ids?: readonly string[];
  label: string;
}) {
  const selection = useInventorySelection();
  if (!selection) return null;

  const all = ids && ids.length > 0 ? ids : [id];

  return (
    <label className="flex shrink-0 cursor-pointer items-center pl-3 pr-0.5">
      <input
        type="checkbox"
        checked={all.every((one) => selection.selected.has(one))}
        onChange={() => selection.toggle(all)}
        aria-label={`Select ${label}`}
        className="size-4 rounded border-border text-accent focus:ring-accent/30"
      />
    </label>
  );
}

/**
 * What to do with the selection. Hidden until something is selected, so the
 * list looks exactly as it did before anyone ticked a box.
 */
export function InventoryBulkBar({ allIds }: { allIds: string[] }) {
  const selection = useInventorySelection();
  const [saleState, saleAction, salePending] = useActionState(
    setItemsForSale,
    {} as ActionState,
  );
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

  if (!selection) return null;

  // Only rows the server still lists. A deleted item leaves `allIds` on the
  // next render, so the bar stops offering to act on things that are gone
  // without needing to reach back into the selection to prune it.
  const present = new Set(allIds);
  const ids = [...selection.selected].filter((id) => present.has(id));
  const pending = salePending || returnPending || deletePending || groupPending;
  const armKey = ids.join(',');
  const confirmingDelete = ids.length > 0 && armedFor === armKey;

  if (ids.length === 0) {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-3 text-ui text-ink-muted">
        <Button type="button" variant="secondary" size="sm" onClick={() => selection.selectAll(allIds)}>
          Select all {allIds.length}
        </Button>
        {deleteState.message ? (
          <span className="text-positive">{deleteState.message}</span>
        ) : (
          <span>or tick items to act on several at once.</span>
        )}
      </div>
    );
  }

  const hidden = ids.map((id) => <input key={id} type="hidden" name="id" value={id} />);

  return (
    <div className="mb-3 space-y-2 rounded-card bg-accent-tint px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-ui font-medium text-ink">
          {ids.length} selected
        </span>

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
            <form action={deleteAction} className="contents">
              {hidden}
              <Button type="submit" size="sm" variant="danger" disabled={pending}>
                {deletePending
                  ? 'Deleting…'
                  : `Delete ${ids.length} permanently`}
              </Button>
            </form>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setArmedFor('')}
            >
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

        <Button type="button" size="sm" variant="ghost" onClick={selection.clear}>
          Clear
        </Button>
      </div>

      {confirmingDelete && (
        <p className="text-ui text-ink">
          This cannot be undone. The order lines stay in spend history.
        </p>
      )}

      {(saleState.message ||
        returnState.message ||
        deleteState.message ||
        groupState.message) && (
        <p className="text-ui text-positive">
          {saleState.message ??
            returnState.message ??
            deleteState.message ??
            groupState.message}
        </p>
      )}
      <FieldError>
        {saleState.error ?? returnState.error ?? deleteState.error ?? groupState.error}
      </FieldError>
    </div>
  );
}
