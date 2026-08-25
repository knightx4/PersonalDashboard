'use client';

import { useActionState } from 'react';
import {
  confirmBookEdition,
  updateBookCondition,
  type BookActionState,
} from '@/app/(app)/inventory/add/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Label, Select } from '@/components/ui/field';

export type BookDetailsView = {
  inventoryItemId: string;
  isbn13: string | null;
  isbn10: string | null;
  authors: string[];
  edition: string | null;
  publisher: string | null;
  publishedYear: number | null;
  condition: string | null;
  needsConfirmation: boolean;
  matchConfidence: number | null;
  resolutionSource: string;
};

export function BookDetailsPanel({ book }: { book: BookDetailsView }) {
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmBookEdition,
    {} as BookActionState,
  );
  const [conditionState, conditionAction, conditionPending] = useActionState(
    updateBookCondition,
    {} as BookActionState,
  );

  return (
    <section className="space-y-4 rounded-card border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">Book details</h2>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {book.isbn13 && (
          <div>
            <dt className="text-ink-muted">ISBN-13</dt>
            <dd className="font-mono text-ink">{book.isbn13}</dd>
          </div>
        )}
        {book.isbn10 && (
          <div>
            <dt className="text-ink-muted">ISBN-10</dt>
            <dd className="font-mono text-ink">{book.isbn10}</dd>
          </div>
        )}
        {book.authors.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-ink-muted">Authors</dt>
            <dd className="text-ink">{book.authors.join(', ')}</dd>
          </div>
        )}
        {book.publisher && (
          <div>
            <dt className="text-ink-muted">Publisher</dt>
            <dd className="text-ink">{book.publisher}</dd>
          </div>
        )}
        {book.publishedYear && (
          <div>
            <dt className="text-ink-muted">Year</dt>
            <dd className="text-ink">{book.publishedYear}</dd>
          </div>
        )}
        {book.edition && (
          <div>
            <dt className="text-ink-muted">Edition</dt>
            <dd className="text-ink">{book.edition}</dd>
          </div>
        )}
        <div>
          <dt className="text-ink-muted">Resolved via</dt>
          <dd className="text-ink">
            {book.resolutionSource.replace('_', ' ')}
            {book.matchConfidence != null
              ? ` · ${Math.round(Number(book.matchConfidence) * 100)}%`
              : ''}
          </dd>
        </div>
      </dl>

      {book.needsConfirmation && (
        <form
          action={confirmAction}
          className="rounded-lg border border-accent-orange/30 bg-accent-orange/5 p-3"
        >
          <input type="hidden" name="inventory_item_id" value={book.inventoryItemId} />
          <p className="text-sm text-ink">
            This edition still needs a confirm tap before it can drive a sell decision.
          </p>
          <Button type="submit" size="sm" className="mt-2" disabled={confirmPending}>
            {confirmPending ? 'Saving…' : 'This is the right edition'}
          </Button>
          <FieldError>{confirmState.error}</FieldError>
          {confirmState.message && (
            <p className="mt-1 text-[13px] text-brand">{confirmState.message}</p>
          )}
        </form>
      )}

      <form action={conditionAction} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="inventory_item_id" value={book.inventoryItemId} />
        <div className="min-w-[12rem] flex-1">
          <Label htmlFor="condition">Condition</Label>
          <Select
            id="condition"
            name="condition"
            defaultValue={book.condition ?? ''}
          >
            <option value="">Not set yet</option>
            <option value="new">New</option>
            <option value="like_new">Like new</option>
            <option value="very_good">Very good</option>
            <option value="good">Good</option>
            <option value="acceptable">Acceptable</option>
          </Select>
        </div>
        <Button type="submit" size="sm" variant="secondary" disabled={conditionPending}>
          {conditionPending ? 'Saving…' : 'Save condition'}
        </Button>
        <FieldError>{conditionState.error}</FieldError>
      </form>
    </section>
  );
}
