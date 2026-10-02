'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Banknote, CalendarDays, Tag } from 'lucide-react';
import {
  ChipInput,
  ChipSelect,
  ComposeBody,
  ComposeBox,
  ComposeTitle,
  FieldError,
} from '@/components/ui/field';
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
    <form action={action} className="space-y-2">
      {/* A compose surface (law 12): the name is the title line, the variant
          and notes are the words under it, and category, cost and date are
          chips. Same field names the action has always read. */}
      <ComposeBox className="space-y-1.5 py-2">
        <ComposeTitle
          name="name"
          required
          autoComplete="off"
          aria-label="Name"
          placeholder="What is it?"
        />
        {/* ui-ok: composer-always-open -- this page is the create; there is
          * nothing here to read yet, and law 14 lets a new thing open in edit. */}
        <ComposeBody
          name="variant"
          rows={1}
          autoComplete="off"
          aria-label="Variant"
          placeholder="Colour, size, model: whatever tells two of them apart"
        />
        {/* ui-ok: composer-always-open -- same create surface as the line above. */}
        <ComposeBody name="notes" rows={1} aria-label="Notes" placeholder="Notes" />
        <div className="-ml-1.5 flex flex-wrap items-center gap-1 pt-1">
          <ChipSelect
            icon={<Tag className="size-3.5" strokeWidth={1.75} />}
            name="category_id"
            aria-label="Category"
            placeholderValue=""
            defaultValue=""
          >
            <option value="">Uncategorised</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </ChipSelect>
          <ChipInput
            icon={<Banknote className="size-3.5" strokeWidth={1.75} />}
            name="cost"
            inputMode="decimal"
            aria-label="What it cost"
            placeholder="What it cost"
          />
          <ChipInput
            icon={<CalendarDays className="size-3.5" strokeWidth={1.75} />}
            name="acquired_at"
            type="date"
            aria-label="Acquired"
          />
          <Button type="submit" size="sm" pending={pending} className="ml-auto">
            {pending ? 'Saving…' : 'Add to inventory'}
          </Button>
        </div>
      </ComposeBox>
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
