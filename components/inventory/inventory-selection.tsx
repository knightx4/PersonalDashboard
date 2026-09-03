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
import { setItemsForSale, type ActionState } from '@/app/shopping/inventory/actions';
import { setItemsReturnPlanned } from '@/app/shopping/returns/actions';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';

type Selection = {
  selected: ReadonlySet<string>;
  toggle: (id: string) => void;
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

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
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

export function InventoryRowCheckbox({ id, label }: { id: string; label: string }) {
  const selection = useInventorySelection();
  if (!selection) return null;

  return (
    <label className="flex shrink-0 cursor-pointer items-center pl-3 pr-0.5">
      <input
        type="checkbox"
        checked={selection.selected.has(id)}
        onChange={() => selection.toggle(id)}
        aria-label={`Select ${label}`}
        className="size-4 rounded border-border text-brand focus:ring-brand/30"
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

  if (!selection) return null;
  const ids = [...selection.selected];
  const pending = salePending || returnPending;

  if (ids.length === 0) {
    return (
      <div className="mb-3 flex flex-wrap items-center gap-3 text-[13px] text-ink-muted">
        <button
          type="button"
          onClick={() => selection.selectAll(allIds)}
          className="press rounded-lg border border-border bg-surface px-2.5 py-1 font-medium text-ink-muted hover:text-ink"
        >
          Select all {allIds.length}
        </button>
        <span>or tick items to act on several at once.</span>
      </div>
    );
  }

  const hidden = ids.map((id) => <input key={id} type="hidden" name="id" value={id} />);

  return (
    <div className="mb-3 space-y-2 rounded-card border border-brand/30 bg-brand-tint px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-[13px] font-medium text-ink">
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

        <Button type="button" size="sm" variant="ghost" onClick={selection.clear}>
          Clear
        </Button>
      </div>

      {(saleState.message || returnState.message) && (
        <p className="text-[13px] text-positive">
          {saleState.message ?? returnState.message}
        </p>
      )}
      <FieldError>{saleState.error ?? returnState.error}</FieldError>
    </div>
  );
}
