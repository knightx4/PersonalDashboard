'use client';

import { useActionState } from 'react';
import {
  disposeInventoryItem,
  markInventoryReturned,
  updateInventoryItem,
  updateInventoryItemLists,
  createItemListAndAssign,
  type ActionState,
} from '@/app/(app)/inventory/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/field';
import { DISPOSAL_METHODS } from '@/lib/inventory/status-actions';
import { formatCentsAsDollarsInput } from '@/lib/money';
import { CATEGORY_COLOR_OPTIONS } from '@/lib/categories/slugify';

const initial: ActionState = {};

interface CategoryOption {
  id: string;
  name: string;
}

export function EditInventoryForm({
  item,
  categories,
}: {
  item: {
    id: string;
    name: string;
    variant: string | null;
    categoryId: string | null;
    notes: string | null;
  };
  categories: CategoryOption[];
}) {
  const [state, action, pending] = useActionState(updateInventoryItem, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={item.id} />
      <div>
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" required defaultValue={item.name} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="variant">Variant</Label>
          <Input id="variant" name="variant" defaultValue={item.variant ?? ''} />
        </div>
        <div>
          <Label htmlFor="category_id">Category</Label>
          <Select id="category_id" name="category_id" defaultValue={item.categoryId ?? ''}>
            <option value="">Uncategorized</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={item.notes ?? ''}
          placeholder="Where it lives, warranty info, anything useful…"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save changes'}
        </Button>
        {state.message && <p className="text-sm text-positive">{state.message}</p>}
      </div>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

export function DisposeForm({
  itemId,
}: {
  itemId: string;
}) {
  const [state, action, pending] = useActionState(disposeInventoryItem, initial);

  return (
    <form action={action} className="space-y-3 rounded-card border border-border bg-surface p-4">
      <input type="hidden" name="id" value={itemId} />
      <h3 className="text-sm font-semibold text-ink">Mark disposed</h3>
      <p className="text-[13px] text-ink-muted">
        Record that you no longer own this. Sold and gifted update status to match.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="disposal_method">How</Label>
          <Select id="disposal_method" name="disposal_method" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {DISPOSAL_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="disposal_proceeds">Proceeds (optional)</Label>
          <Input
            id="disposal_proceeds"
            name="disposal_proceeds"
            inputMode="decimal"
            placeholder="0.00"
          />
        </div>
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Saving…' : 'Mark disposed'}
      </Button>
      {state.message && <p className="text-sm text-positive">{state.message}</p>}
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

export function ReturnForm({
  itemId,
  defaultRefundCents,
}: {
  itemId: string;
  defaultRefundCents: number;
}) {
  const [state, action, pending] = useActionState(markInventoryReturned, initial);

  return (
    <form action={action} className="space-y-3 rounded-card border border-border bg-surface p-4">
      <input type="hidden" name="id" value={itemId} />
      <h3 className="text-sm font-semibold text-ink">Mark returned</h3>
      <p className="text-[13px] text-ink-muted">
        Creates a refunded return. Inventory status is derived from that — it is never written
        by hand.
      </p>
      <div>
        <Label htmlFor="refund_amount">Refund amount</Label>
        <Input
          id="refund_amount"
          name="refund_amount"
          inputMode="decimal"
          defaultValue={formatCentsAsDollarsInput(defaultRefundCents)}
        />
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Saving…' : 'Mark returned'}
      </Button>
      {state.message && <p className="text-sm text-positive">{state.message}</p>}
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

export function ItemListsForm({
  itemId,
  lists,
  selectedListIds,
}: {
  itemId: string;
  lists: Array<{ id: string; name: string; color: string | null }>;
  selectedListIds: string[];
}) {
  const [saveState, saveAction, savePending] = useActionState(
    updateInventoryItemLists,
    initial,
  );
  const [createState, createAction, createPending] = useActionState(
    createItemListAndAssign,
    initial,
  );
  const selected = new Set(selectedListIds);

  return (
    <div className="space-y-3 rounded-card border border-border bg-surface p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">Lists</h3>
        <p className="mt-1 text-[13px] text-ink-muted">
          Personal trackers — not categories. Filter inventory by any list you add here.
        </p>
      </div>

      {lists.length > 0 ? (
        <form action={saveAction} className="space-y-3">
          <input type="hidden" name="id" value={itemId} />
          <ul className="space-y-2">
            {lists.map((list) => (
              <li key={list.id}>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    name="list_id"
                    value={list.id}
                    defaultChecked={selected.has(list.id)}
                    className="size-4 rounded border-border text-brand focus:ring-brand/30"
                  />
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: list.color ?? '#cfcfc8' }}
                    aria-hidden
                  />
                  {list.name}
                </label>
              </li>
            ))}
          </ul>
          <Button type="submit" variant="secondary" size="sm" disabled={savePending}>
            {savePending ? 'Saving…' : 'Save lists'}
          </Button>
          {saveState.message && <p className="text-sm text-positive">{saveState.message}</p>}
          <FieldError>{saveState.error}</FieldError>
        </form>
      ) : (
        <p className="text-[13px] text-ink-faint">No lists yet — create one below.</p>
      )}

      <form
        action={createAction}
        className="space-y-3 border-t border-border pt-3"
      >
        <input type="hidden" name="id" value={itemId} />
        <p className="text-sm font-medium text-ink">New list</p>
        <div>
          <Label htmlFor="new_list_name">Name</Label>
          <Input
            id="new_list_name"
            name="name"
            required
            maxLength={40}
            placeholder="To return, Gift ideas, Cabin…"
          />
        </div>
        <div>
          <Label>Color</Label>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="List color">
            {CATEGORY_COLOR_OPTIONS.map((color, index) => (
              <label key={color} className="cursor-pointer">
                <input
                  type="radio"
                  name="color"
                  value={color}
                  defaultChecked={index === 0}
                  className="peer sr-only"
                />
                <span
                  className="block size-7 rounded-full border-2 border-transparent peer-checked:border-ink peer-focus-visible:ring-2 peer-focus-visible:ring-brand/30"
                  style={{ backgroundColor: color }}
                  aria-hidden
                />
                <span className="sr-only">{color}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={createPending}>
            {createPending ? 'Adding…' : 'Create list & add item'}
          </Button>
          {createState.message && (
            <p className="text-sm text-positive">{createState.message}</p>
          )}
        </div>
        <FieldError>{createState.error}</FieldError>
      </form>
    </div>
  );
}
