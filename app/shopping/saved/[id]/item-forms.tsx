'use client';

import { useActionState } from 'react';
import {
  deleteSavedItem,
  dismissSavedItem,
  markSavedPurchased,
  restoreSavedItem,
  updateSavedItem,
  type ActionState,
} from '@/app/shopping/saved/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, Textarea } from '@/components/ui/field';
import { formatCentsAsDollarsInput } from '@/lib/money';

const initial: ActionState = {};

export function EditSavedForm({
  item,
}: {
  item: {
    id: string;
    url: string;
    title: string | null;
    imageUrl: string | null;
    priceCents: number | null;
    currency: string;
    notes: string | null;
    merchantId: string | null;
  };
}) {
  const [state, action, pending] = useActionState(updateSavedItem, initial);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="merchant_id" value={item.merchantId ?? ''} />
      <input type="hidden" name="currency" value={item.currency} />
      <div>
        <Label htmlFor="title">Title</Label>
        <Input id="title" name="title" required defaultValue={item.title ?? ''} />
      </div>
      <div>
        <Label htmlFor="url">URL</Label>
        <Input id="url" name="url" type="url" required defaultValue={item.url} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="price">Price</Label>
          <Input
            id="price"
            name="price"
            inputMode="decimal"
            placeholder="12.99"
            defaultValue={
              item.priceCents != null ? formatCentsAsDollarsInput(item.priceCents) : ''
            }
          />
        </div>
        <div>
          <Label htmlFor="image_url">Image URL</Label>
          <Input
            id="image_url"
            name="image_url"
            type="url"
            defaultValue={item.imageUrl ?? ''}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea id="notes" name="notes" defaultValue={item.notes ?? ''} />
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

function StatusForm({
  itemId,
  action,
  label,
  pendingLabel,
  variant = 'secondary',
}: {
  itemId: string;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  label: string;
  pendingLabel: string;
  variant?: 'secondary' | 'danger' | 'primary';
}) {
  const [state, formAction, pending] = useActionState(action, initial);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="id" value={itemId} />
      <Button type="submit" variant={variant} disabled={pending} className="w-full sm:w-auto">
        {pending ? pendingLabel : label}
      </Button>
      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-[13px] text-positive">{state.message}</p>}
    </form>
  );
}

export function SavedStatusActions({
  itemId,
  status,
}: {
  itemId: string;
  status: 'saved' | 'purchased' | 'dismissed';
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      {status !== 'purchased' && (
        <StatusForm
          itemId={itemId}
          action={markSavedPurchased}
          label="Mark purchased"
          pendingLabel="Updating…"
          variant="primary"
        />
      )}
      {status !== 'dismissed' && (
        <StatusForm
          itemId={itemId}
          action={dismissSavedItem}
          label="Dismiss"
          pendingLabel="Dismissing…"
        />
      )}
      {status !== 'saved' && (
        <StatusForm
          itemId={itemId}
          action={restoreSavedItem}
          label="Move back to saved"
          pendingLabel="Restoring…"
        />
      )}
      <StatusForm
        itemId={itemId}
        action={deleteSavedItem}
        label="Delete"
        pendingLabel="Deleting…"
        variant="danger"
      />
    </div>
  );
}
