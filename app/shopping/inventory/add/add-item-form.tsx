'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/field';
import { saveManualItem, type ItemActionState } from './item-actions';

export type CategoryOption = { id: string; name: string };

/**
 * Type in something you own.
 *
 * Name is the only required field: an item you can find later is worth more
 * than an item you gave up entering. Everything else is here because it is
 * what the inventory list actually filters and totals by.
 */
export function AddItemForm({ categories }: { categories: readonly CategoryOption[] }) {
  const [state, action, pending] = useActionState(saveManualItem, {} as ItemActionState);

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="item_name">Name</Label>
          <Input id="item_name" name="name" required autoComplete="off" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="item_variant">Variant</Label>
          <Input
            id="item_variant"
            name="variant"
            placeholder="Colour, size, model — whatever tells two of them apart"
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="item_category">Category</Label>
          <Select id="item_category" name="category_id" defaultValue="">
            <option value="">Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="item_cost">What it cost</Label>
          <Input id="item_cost" name="cost" inputMode="decimal" placeholder="0.00" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="item_acquired">Acquired</Label>
          <Input id="item_acquired" name="acquired_at" type="date" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="item_notes">Notes</Label>
          <Textarea id="item_notes" name="notes" rows={3} />
        </div>
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Saving…' : 'Add to inventory'}
      </Button>
      <FieldError>{state.error}</FieldError>
      {state.message && (
        <p className="text-body text-accent">
          {state.message}{' '}
          {state.savedId && (
            <Link className="underline" href={`/shopping/inventory/${state.savedId}`}>
              Open it
            </Link>
          )}
        </p>
      )}
    </form>
  );
}
