'use client';

import { useActionState, useState } from 'react';
import {
  disposeInventoryItem,
  markInventoryReturned,
  updateInventoryItemLists,
  createItemListAndAssign,
  type ActionState,
} from '@/app/shopping/inventory/actions';
import { Button } from '@/components/ui/button';
import { AddTrigger } from '@/components/ui/add-trigger';
import { CardSection, cardVariants } from '@/components/ui/card';
import { Field, FieldError, Input, Select } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { DISPOSAL_METHODS } from '@/lib/inventory/status-actions';
import { formatCentsAsDollarsInput } from '@/lib/money';
import { listSwatchStyle } from '@/lib/lists/gradients';

const initial: ActionState = {};

export function DisposeForm({
  itemId,
}: {
  itemId: string;
}) {
  const [state, action, pending] = useActionState(disposeInventoryItem, initial);

  return (
    <form action={action} className={cn(cardVariants({ padding: 'dense' }), 'space-y-3')}>
      <input type="hidden" name="id" value={itemId} />
      <h3 className="text-ui font-semibold text-ink">Mark disposed</h3>
      <p className="text-ui text-ink-muted">
        Record that you no longer own this. Sold and gifted update status to match;
        consumed / donated / trashed / recycled mark it disposed.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="disposal_method" label="How">
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
        </Field>
        <Field id="disposal_proceeds" label="Proceeds (optional)">
          <Input
            id="disposal_proceeds"
            name="disposal_proceeds"
            inputMode="decimal"
            placeholder="0.00"
          />
        </Field>
      </div>
      <Button type="submit" variant="secondary" pending={pending}>
        {pending ? 'Saving…' : 'Mark disposed'}
      </Button>
      {state.message && <p className="text-body text-positive">{state.message}</p>}
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
    <form action={action} className={cn(cardVariants({ padding: 'dense' }), 'space-y-3')}>
      <input type="hidden" name="id" value={itemId} />
      <h3 className="text-ui font-semibold text-ink">Mark returned</h3>
      <p className="text-ui text-ink-muted">
        Creates a refunded return. Inventory status is derived from that — it is never written
        by hand.
      </p>
      <Field id="refund_amount" label="Refund amount">
        <Input
          id="refund_amount"
          name="refund_amount"
          inputMode="decimal"
          defaultValue={formatCentsAsDollarsInput(defaultRefundCents)}
        />
      </Field>
      <Button type="submit" variant="secondary" pending={pending}>
        {pending ? 'Saving…' : 'Mark returned'}
      </Button>
      {state.message && <p className="text-body text-positive">{state.message}</p>}
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
  const [creating, setCreating] = useState(false);
  const [createState, createAction, createPending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const next = await createItemListAndAssign(prev, formData);
      if (next.message) setCreating(false);
      return next;
    },
    initial,
  );
  const selected = new Set(selectedListIds);

  return (
    <CardSection title="Lists">
      <div className="space-y-3">
      <p className="text-ui text-ink-muted">
        Personal trackers — not categories. Filter inventory by any list you add here.
      </p>

      {lists.length > 0 ? (
        <form action={saveAction} className="space-y-3">
          <input type="hidden" name="id" value={itemId} />
          <ul className="space-y-2">
            {lists.map((list) => (
              <li key={list.id}>
                <label className="flex cursor-pointer items-center gap-2 text-body text-ink">
                  <input
                    type="checkbox"
                    name="list_id"
                    value={list.id}
                    defaultChecked={selected.has(list.id)}
                    className="size-4 rounded border-border text-accent focus:ring-accent/30"
                  />
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={listSwatchStyle(list.color)}
                    aria-hidden
                  />
                  {list.name}
                </label>
              </li>
            ))}
          </ul>
          <Button type="submit" variant="secondary" size="sm" pending={savePending}>
            {savePending ? 'Saving…' : 'Save lists'}
          </Button>
          {saveState.message && <p className="text-body text-positive">{saveState.message}</p>}
          <FieldError>{saveState.error}</FieldError>
        </form>
      ) : (
        !creating && (
          <p className="text-ui text-ink-muted">No lists yet — create one below.</p>
        )
      )}

      {creating ? (
        <form
          action={createAction}
          className="flex flex-wrap items-center gap-2 border-t border-border pt-3"
        >
          <input type="hidden" name="id" value={itemId} />
          <Input
            name="name"
            required
            maxLength={40}
            autoFocus
            placeholder="To return, Gift ideas, Cabin…"
            className="min-w-48 flex-1"
            aria-label="New list name"
          />
          <Button type="submit" size="sm" pending={createPending}>
            {createPending ? 'Adding…' : 'Add'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCreating(false)}
            disabled={createPending}
          >
            Cancel
          </Button>
          <FieldError>{createState.error}</FieldError>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
          {/* A trigger for a compose surface, not a button competing with the
              list above it (law 14): the form it opens is the point, and a
              bordered control standing in for one is the empty box again
              wearing a different shape. */}
          <AddTrigger label="New list" onClick={() => setCreating(true)} />
          {createState.message && (
            <p className="text-body text-positive">{createState.message}</p>
          )}
        </div>
      )}
      </div>
    </CardSection>
  );
}
