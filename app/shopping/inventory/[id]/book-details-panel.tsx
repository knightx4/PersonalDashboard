'use client';

import { useActionState, useRef } from 'react';
import Link from 'next/link';
import {
  confirmBookEdition,
  switchBookEdition,
  updateBookCondition,
  type BookActionState,
} from '@/app/shopping/inventory/add/actions';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Disclosure, Group } from '@/components/ui/disclosure';
import { ChipSelect, FieldError } from '@/components/ui/field';
import type { BookEditionCandidate } from '@/lib/books/types';

export type BookDetailsView = {
  inventoryItemId: string;
  title: string;
  imageUrl: string | null;
  isbn13: string | null;
  isbn10: string | null;
  authors: string[];
  edition: string | null;
  publisher: string | null;
  publishedYear: number | null;
  condition: string | null;
  needsConfirmation: boolean;
  confirmationReason: string | null;
  candidates: BookEditionCandidate[];
  autoImported: boolean;
  matchConfidence: number | null;
  resolutionSource: string;
};

const SOURCE_LABEL: Record<string, string> = {
  google_books: 'Google Books',
  open_library: 'Open Library',
  isbndb: 'ISBNdb',
  manual: 'entered by hand',
};

/** One identity row; always rendered so a missing field reads as “unknown”. */
function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number | null;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className={value ? (mono ? 'font-mono text-ink' : 'text-ink') : 'text-ink-muted'}>
        {value || 'Not listed'}
      </dd>
    </div>
  );
}

function editionLine(book: {
  publisher: string | null;
  publishedYear: number | null;
  edition: string | null;
}): string {
  const parts = [book.edition, book.publisher, book.publishedYear]
    .filter(Boolean)
    .map(String);
  return parts.length > 0 ? parts.join(' · ') : 'Edition not stated by the catalog';
}

function CandidateRow({
  inventoryItemId,
  candidate,
}: {
  inventoryItemId: string;
  candidate: BookEditionCandidate;
}) {
  const [state, action, pending] = useActionState(
    switchBookEdition,
    {} as BookActionState,
  );

  return (
    <li className="row-pad flex gap-3">
      {candidate.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary catalog CDNs
        <img
          src={candidate.coverUrl}
          alt=""
          className="h-16 w-11 shrink-0 rounded object-cover bg-canvas"
        />
      ) : (
        <div className="h-16 w-11 shrink-0 rounded bg-canvas" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium text-ink">{candidate.title}</p>
        {candidate.authors.length > 0 && (
          <p className="text-ui text-ink-muted">{candidate.authors.join(', ')}</p>
        )}
        <p className="text-ui text-ink-muted">{editionLine(candidate)}</p>
        {candidate.isbn13 && (
          <p className="font-mono text-small text-ink-muted">ISBN {candidate.isbn13}</p>
        )}
        <form action={action} className="mt-2">
          <input type="hidden" name="inventory_item_id" value={inventoryItemId} />
          <input type="hidden" name="candidate_json" value={JSON.stringify(candidate)} />
          <Button type="submit" size="sm" variant="secondary" pending={pending}>
            {pending ? 'Switching…' : 'This is my copy'}
          </Button>
        </form>
        <FieldError>{state.error}</FieldError>
      </div>
    </li>
  );
}

/**
 * A book's identity, its condition, and the confirmation gate pricing waits on.
 *
 * The top of the item's one Details box, not a box of its own — see the note on
 * GameDetailsPanel. The ISBNs are rendered only when the catalog has them,
 * because the books template carries an ISBN field of its own and the page
 * hides whichever of the pair is the duplicate.
 */
export function BookDetailsPanel({ book }: { book: BookDetailsView }) {
  const [confirmState, confirmAction, confirmPending] = useActionState(
    confirmBookEdition,
    {} as BookActionState,
  );
  const [conditionState, conditionAction, conditionPending] = useActionState(
    updateBookCondition,
    {} as BookActionState,
  );
  const conditionForm = useRef<HTMLFormElement>(null);

  return (
    <div className="space-y-4">
      {book.autoImported && (
        <p className="text-small text-ink-muted">Imported from an order email</p>
      )}

      <dl className="grid gap-2 text-body sm:grid-cols-2">
        {book.isbn13 && <Fact label="ISBN-13" value={book.isbn13} mono />}
        {book.isbn10 && <Fact label="ISBN-10" value={book.isbn10} mono />}
        <div className="sm:col-span-2">
          <Fact
            label="Authors"
            value={book.authors.length > 0 ? book.authors.join(', ') : null}
          />
        </div>
        <Fact label="Publisher" value={book.publisher} />
        <Fact label="Year" value={book.publishedYear} />
        <Fact label="Edition" value={book.edition} />
        <div>
          <dt className="text-ink-muted">Resolved via</dt>
          <dd className="text-ink">
            {SOURCE_LABEL[book.resolutionSource] ?? book.resolutionSource.replace('_', ' ')}
            {book.matchConfidence != null
              ? ` · ${Math.round(Number(book.matchConfidence) * 100)}% match`
              : ''}
          </dd>
        </div>
        {/*
          * Condition is a fact about the copy, so it is a row in the same list
          * as the rest of them — and it is the row that can be changed.
          *
          * It used to be a labelled full-width select in a form of its own
          * under the catalog facts, with a "Save condition" button beside it:
          * a form about a value, printed below the value. It is the value now,
          * set where the other facts are set, and it commits when it changes.
          * That is safe here for the reasons a return window's blur-commit is
          * — one short enum, reversible from the same chip, and no
          * half-finished state to save by accident. Laws 9 and 12.
          */}
        <div>
          <dt className="text-ink-muted">Condition</dt>
          <dd>
            <form ref={conditionForm} action={conditionAction}>
              <input type="hidden" name="inventory_item_id" value={book.inventoryItemId} />
              <ChipSelect
                name="condition"
                aria-label="Condition"
                // Re-keyed on the saved value, so the chip follows a save
                // rather than holding whatever was picked last.
                key={book.condition ?? ''}
                defaultValue={book.condition ?? ''}
                placeholderValue=""
                disabled={conditionPending}
                onChange={() => conditionForm.current?.requestSubmit()}
                // Pulls the chip's own inset back, so its value sits on the
                // same left edge as every other one in the grid.
                className="-ml-1.5"
              >
                <option value="">Not set yet</option>
                <option value="new">New</option>
                <option value="like_new">Like new</option>
                <option value="very_good">Very good</option>
                <option value="good">Good</option>
                <option value="acceptable">Acceptable</option>
              </ChipSelect>
            </form>
            <FieldError>{conditionState.error}</FieldError>
          </dd>
        </div>
      </dl>

      {/* The same gate the game panel draws, and for the same reason: one
          warn Banner where there was a caution box holding a bordered card
          holding a bordered list, three frames deep inside the Details card
          it sits in. Law 11. */}
      {book.needsConfirmation && (
        <Banner tone="warn">
          <div>
            <h3 className="text-ui font-semibold text-ink">Which edition is on your shelf?</h3>
            <p className="mt-1 text-ui text-ink-muted">
              {book.confirmationReason ??
                'We could not pin this to a single printing, and buyback quotes are per ISBN.'}
            </p>
          </div>

          <Group title="Our best guess" className="mt-3">
            <div className="flex gap-3">
              {book.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- arbitrary catalog CDNs
                <img
                  src={book.imageUrl}
                  alt=""
                  className="h-16 w-11 shrink-0 rounded object-cover bg-canvas"
                />
              ) : (
                <div className="h-16 w-11 shrink-0 rounded bg-canvas" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium text-ink">{book.title}</p>
                {book.authors.length > 0 && (
                  <p className="text-ui text-ink-muted">{book.authors.join(', ')}</p>
                )}
                <p className="text-ui text-ink-muted">{editionLine(book)}</p>
                {book.isbn13 && (
                  <p className="font-mono text-small text-ink-muted">ISBN {book.isbn13}</p>
                )}
                <form action={confirmAction} className="mt-2">
                  <input
                    type="hidden"
                    name="inventory_item_id"
                    value={book.inventoryItemId}
                  />
                  <Button type="submit" size="sm" pending={confirmPending}>
                    {confirmPending ? 'Saving…' : 'This is the right edition'}
                  </Button>
                </form>
                <FieldError>{confirmState.error}</FieldError>
                {confirmState.message && (
                  <p className="mt-1 text-ui text-accent">{confirmState.message}</p>
                )}
              </div>
            </div>
          </Group>

          {/* Folded, with the count on the closed line. The answer is almost
              always the guess above, and five covers stacked under it is a
              wall in front of the one button that matters; the count is what
              makes opening it a choice rather than a check. Law 10. */}
          {book.candidates.length > 0 && (
            <Disclosure
              title="Other printings we found"
              meta={`${book.candidates.length}`}
              className="mt-3"
            >
              <ul className="divide-y divide-border">
                {book.candidates.map((candidate, index) => (
                  <CandidateRow
                    key={candidate.isbn13 ?? `${candidate.title}-${index}`}
                    inventoryItemId={book.inventoryItemId}
                    candidate={candidate}
                  />
                ))}
              </ul>
            </Disclosure>
          )}

          <p className="mt-3 text-small text-ink-muted">
            Neither one? Scan the barcode on the back cover from{' '}
            <Link href="/shopping/inventory/add/books" className="text-accent hover:underline">
              Add books
            </Link>{' '}
            — the ISBN settles it in one shot.
          </p>
        </Banner>
      )}
    </div>
  );
}
