'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import {
  previewPasteBookList,
  saveManualBook,
  saveOwnedBook,
  savePasteBookList,
  searchOwnedBook,
  type BookActionState,
} from './actions';
import { Button } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { Group } from '@/components/ui/disclosure';
import { FieldError, Input, Label, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import type { CanonicalBook } from '@/lib/books/types';

/**
 * By-hand entry. The escape hatch for a book too new for any catalog — and
 * the reason a failed lookup is never a dead end.
 */
export function AddBookManualForm({
  isbn,
  compact,
}: {
  isbn?: string | null;
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState(
    saveManualBook,
    {} as BookActionState,
  );

  return (
    <form
      action={action}
      className={cn(
        'flex flex-col gap-3',
        // Only the fallback copy is a card: it appears under a failed lookup
        // and has to read as a thing offered rather than as the page. The
        // shape is the shared one -- the hand-rolled box it replaces was
        // invisible to the gate because it was spelled in a ternary.
        compact && cardVariants({ padding: 'standard' }),
      )}
    >
      {compact && (
        <div>
          <p className="text-body font-medium text-ink">Add it by hand</p>
          <p className="text-ui text-ink-muted">
            {isbn
              ? 'We keep the scanned ISBN, so buyback and eBay quotes still work.'
              : 'No catalog record needed.'}
          </p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="manual_title">Title</Label>
          <Input id="manual_title" name="title" required autoComplete="off" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="manual_authors">Authors</Label>
          <Input
            id="manual_authors"
            name="authors"
            placeholder="Comma separated"
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="manual_isbn">ISBN</Label>
          <Input
            id="manual_isbn"
            name="isbn"
            defaultValue={isbn ?? ''}
            placeholder="From the back cover"
            autoComplete="off"
          />
        </div>
        <div>
          <Label htmlFor="manual_publisher">Publisher</Label>
          <Input id="manual_publisher" name="publisher" autoComplete="off" />
        </div>
        <div>
          <Label htmlFor="manual_year">Year</Label>
          <Input id="manual_year" name="published_year" inputMode="numeric" />
        </div>
        <div>
          <Label htmlFor="manual_edition">Edition</Label>
          <Input
            id="manual_edition"
            name="edition"
            placeholder="First edition, revised…"
          />
        </div>
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Saving…' : 'Add to library'}
      </Button>
      <FieldError>{state.error}</FieldError>
      {state.message && (
        <p className="text-body text-accent">
          {state.message}{' '}
          {state.savedIds?.[0] && (
            <Link className="underline" href={`/shopping/inventory/${state.savedIds[0]}`}>
              View item
            </Link>
          )}
        </p>
      )}
    </form>
  );
}

function BookCard({
  book,
  onSave,
  onPick,
  pending,
}: {
  book: CanonicalBook;
  onSave: (forceConfirmed: boolean) => void;
  /** Swap the previewed match for one of the runner-up editions. */
  onPick?: (candidate: CanonicalBook) => void;
  pending: boolean;
}) {
  return (
    // The one thing the search came back for, so it is a card the eye rests
    // on rather than a hand-drawn box. Law 11.
    <Card padding="standard" className="flex gap-4">
      {book.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={book.coverUrl}
          alt=""
          className="h-28 w-20 shrink-0 rounded-md object-cover bg-canvas"
        />
      ) : (
        <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-md bg-canvas text-small text-ink-muted">
          No cover
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{book.title}</p>
        {book.authors.length > 0 && (
          <p className="text-body text-ink-muted">{book.authors.join(', ')}</p>
        )}
        <p className="mt-1 text-ui text-ink-muted">
          {[book.publisher, book.publishedYear, book.edition].filter(Boolean).join(' · ')}
        </p>
        {book.isbn13 && (
          <p className="mt-1 font-mono text-small text-ink-muted">ISBN {book.isbn13}</p>
        )}
        {book.needsConfirmation ? (
          <p className="mt-2 text-ui text-caution">
            {book.confirmationReason ??
              'More than one printing matches — confirm the edition before selling.'}
          </p>
        ) : (
          <p className="mt-2 text-ui text-accent">
            Exact ISBN match — edition is settled, sell-ready.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => onSave(true)}
          >
            {book.needsConfirmation ? 'Yes — this edition' : 'Add to library'}
          </Button>
          {book.needsConfirmation && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => onSave(false)}
            >
              Save, I&rsquo;ll check the ISBN later
            </Button>
          )}
        </div>

        {book.needsConfirmation && (book.alternates?.length ?? 0) > 0 && (
          // A heading and space rather than a second frame inside the card,
          // and the shared heading rather than a fourth weight for one.
          <Group title="Other printings we found" className="mt-3">
            <ul className="divide-y divide-border">
              {book.alternates?.map((candidate, index) => (
                <li
                  key={candidate.isbn13 ?? `${candidate.title}-${index}`}
                  className="row-pad flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-ui text-ink">{candidate.title}</p>
                    <p className="text-small text-ink-muted">
                      {[
                        candidate.authors.join(', ') || null,
                        candidate.edition,
                        candidate.publisher,
                        candidate.publishedYear,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Edition not stated by the catalog'}
                    </p>
                    {candidate.isbn13 && (
                      <p className="font-mono text-small text-ink-muted">
                        ISBN {candidate.isbn13}
                      </p>
                    )}
                  </div>
                  {onPick && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() =>
                        onPick({
                          isbn13: candidate.isbn13,
                          isbn10: candidate.isbn10,
                          title: candidate.title,
                          authors: candidate.authors,
                          publisher: candidate.publisher,
                          publishedYear: candidate.publishedYear,
                          edition: candidate.edition,
                          coverUrl: candidate.coverUrl,
                          weightGrams: null,
                          matchConfidence: 1,
                          needsConfirmation: false,
                          resolutionSource: candidate.source,
                          alternates: [],
                          confirmationReason: null,
                        })
                      }
                    >
                      This one
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Group>
        )}
      </div>
    </Card>
  );
}

export function AddBookSearchForm() {
  const [searchState, searchAction, searchPending] = useActionState(
    searchOwnedBook,
    {} as BookActionState,
  );
  const [saveState, saveAction, savePending] = useActionState(
    saveOwnedBook,
    {} as BookActionState,
  );
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<CanonicalBook | null>(null);
  const shown = picked ?? searchState.book ?? null;

  function saveBook(forceConfirmed: boolean) {
    if (!shown) return;
    const fd = new FormData();
    fd.set('book_json', JSON.stringify(shown));
    fd.set('force_confirmed', forceConfirmed ? 'true' : 'false');
    fd.set('source', 'manual');
    saveAction(fd);
  }

  return (
    <div className="flex flex-col gap-4">
      <form
        action={searchAction}
        onSubmit={() => setPicked(null)}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
          <Label htmlFor="query">ISBN or title</Label>
          <Input
            id="query"
            name="query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="9780735211292 or Atomic Habits"
            autoComplete="off"
          />
        </div>
        <Button type="submit" disabled={searchPending}>
          {searchPending ? 'Searching…' : 'Search'}
        </Button>
      </form>
      <FieldError>{searchState.error ?? saveState.error}</FieldError>
      {saveState.message && (
        <p className="text-body text-accent">
          {saveState.message}{' '}
          {saveState.savedIds?.[0] && (
            <Link className="underline" href={`/shopping/inventory/${saveState.savedIds[0]}`}>
              View item
            </Link>
          )}
        </p>
      )}
      {shown && (
        <BookCard
          book={shown}
          onSave={saveBook}
          onPick={setPicked}
          pending={savePending}
        />
      )}

      {!shown && searchState.error && (
        <AddBookManualForm compact isbn={searchState.manualIsbn} />
      )}
    </div>
  );
}

export function AddBookPasteForm() {
  const [previewState, previewAction, previewPending] = useActionState(
    previewPasteBookList,
    {} as BookActionState,
  );
  const [saveState, saveAction, savePending] = useActionState(
    savePasteBookList,
    {} as BookActionState,
  );

  const resolvedBooks = (previewState.results ?? [])
    .map((row, index) => ({ row, index }))
    .filter((entry): entry is { row: NonNullable<(typeof previewState.results)>[number]; index: number } =>
      Boolean(entry.row.book),
    );

  const booksPayload = resolvedBooks.map((entry) => entry.row.book!);

  return (
    <div className="flex flex-col gap-4">
      <form action={previewAction} className="flex flex-col gap-3">
        <div>
          <Label htmlFor="paste">Paste a list</Label>
          {/* ui-ok: composer-always-open -- the create. Pasting is the action
            * the page exists for. */}
          <Textarea
            id="paste"
            name="paste"
            rows={8}
            placeholder={'Atomic Habits by James Clear\n9780143127550\nDune — Frank Herbert'}
          />
        </div>
        <Button type="submit" disabled={previewPending} className="self-start">
          {previewPending ? 'Resolving…' : 'Resolve list'}
        </Button>
      </form>
      <FieldError>{previewState.error ?? saveState.error}</FieldError>
      {saveState.message && <p className="text-body text-accent">{saveState.message}</p>}

      {previewState.results && previewState.results.length > 0 && (
        <form action={saveAction} className="flex flex-col gap-3">
          <input type="hidden" name="books_json" value={JSON.stringify(booksPayload)} />
          {/* The resolved list is the result the page is about: one card,
              divides inside it, rows on the density dial. Law 11. */}
          <ul className={cn(cardVariants({ padding: 'none' }), 'divide-y divide-border')}>
            {previewState.results.map((row, resultIndex) => {
              if (!row.book) {
                return (
                  <li key={resultIndex} className="card-pad-x row-pad text-body text-ink-muted">
                    <span className="font-medium text-ink">{row.raw}</span>
                    <span className="ml-2 text-danger">{row.error ?? 'No match'}</span>
                  </li>
                );
              }
              const payloadIndex = resolvedBooks.findIndex((e) => e.index === resultIndex);
              return (
                <li key={resultIndex} className="card-pad-x row-pad flex items-start gap-3">
                  <input
                    type="checkbox"
                    name="selected"
                    value={String(payloadIndex)}
                    defaultChecked={!row.book.needsConfirmation}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{row.book.title}</p>
                    <p className="text-ui text-ink-muted">
                      {row.book.authors.join(', ')}
                      {row.book.isbn13 ? ` · ${row.book.isbn13}` : ''}
                    </p>
                    {row.book.needsConfirmation && (
                      <p className="mt-1 text-small text-ink-muted">
                        {[
                          row.book.edition,
                          row.book.publisher,
                          row.book.publishedYear,
                        ]
                          .filter(Boolean)
                          .join(' · ') || 'Edition not stated by the catalog'}
                        {row.book.confirmationReason
                          ? ` — ${row.book.confirmationReason}`
                          : ''}
                      </p>
                    )}
                    {row.book.needsConfirmation && (
                      <label className="mt-2 flex items-center gap-2 text-ui text-caution">
                        <input
                          type="checkbox"
                          name="confirmed"
                          value={String(payloadIndex)}
                        />
                        Confirm this edition
                      </label>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <Button
            type="submit"
            disabled={savePending || booksPayload.length === 0}
            className="self-start"
          >
            {savePending ? 'Saving…' : 'Save selected'}
          </Button>
        </form>
      )}
    </div>
  );
}
