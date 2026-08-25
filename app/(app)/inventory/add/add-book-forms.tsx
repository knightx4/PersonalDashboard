'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import {
  previewPasteBookList,
  saveOwnedBook,
  savePasteBookList,
  searchOwnedBook,
  type BookActionState,
} from './actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, Textarea } from '@/components/ui/field';
import type { CanonicalBook } from '@/lib/books/types';

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
    <div className="flex gap-4 rounded-xl border border-border bg-surface p-4">
      {book.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={book.coverUrl}
          alt=""
          className="h-28 w-20 shrink-0 rounded-md object-cover bg-canvas"
        />
      ) : (
        <div className="flex h-28 w-20 shrink-0 items-center justify-center rounded-md bg-canvas text-xs text-ink-faint">
          No cover
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-ink">{book.title}</p>
        {book.authors.length > 0 && (
          <p className="text-sm text-ink-muted">{book.authors.join(', ')}</p>
        )}
        <p className="mt-1 text-[13px] text-ink-faint">
          {[book.publisher, book.publishedYear, book.edition].filter(Boolean).join(' · ')}
        </p>
        {book.isbn13 && (
          <p className="mt-1 font-mono text-[12px] text-ink-muted">ISBN {book.isbn13}</p>
        )}
        {book.needsConfirmation ? (
          <p className="mt-2 text-[13px] text-accent-orange">
            {book.confirmationReason ??
              'More than one printing matches — confirm the edition before selling.'}
          </p>
        ) : (
          <p className="mt-2 text-[13px] text-brand">
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
          <div className="mt-3">
            <p className="text-[13px] font-medium text-ink">Other printings we found</p>
            <ul className="mt-1 divide-y divide-border rounded-lg border border-border">
              {book.alternates?.map((candidate, index) => (
                <li
                  key={candidate.isbn13 ?? `${candidate.title}-${index}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] text-ink">{candidate.title}</p>
                    <p className="text-[12px] text-ink-muted">
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
                      <p className="font-mono text-[12px] text-ink-faint">
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
          </div>
        )}
      </div>
    </div>
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
        <p className="text-sm text-brand">
          {saveState.message}{' '}
          {saveState.savedIds?.[0] && (
            <Link className="underline" href={`/inventory/${saveState.savedIds[0]}`}>
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
      {saveState.message && <p className="text-sm text-brand">{saveState.message}</p>}

      {previewState.results && previewState.results.length > 0 && (
        <form action={saveAction} className="flex flex-col gap-3">
          <input type="hidden" name="books_json" value={JSON.stringify(booksPayload)} />
          <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
            {previewState.results.map((row, resultIndex) => {
              if (!row.book) {
                return (
                  <li key={resultIndex} className="px-4 py-3 text-sm text-ink-muted">
                    <span className="font-medium text-ink">{row.raw}</span>
                    <span className="ml-2 text-red-600">{row.error ?? 'No match'}</span>
                  </li>
                );
              }
              const payloadIndex = resolvedBooks.findIndex((e) => e.index === resultIndex);
              return (
                <li key={resultIndex} className="flex items-start gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    name="selected"
                    value={String(payloadIndex)}
                    defaultChecked={!row.book.needsConfirmation}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-ink">{row.book.title}</p>
                    <p className="text-[13px] text-ink-muted">
                      {row.book.authors.join(', ')}
                      {row.book.isbn13 ? ` · ${row.book.isbn13}` : ''}
                    </p>
                    {row.book.needsConfirmation && (
                      <p className="mt-1 text-[12px] text-ink-faint">
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
                      <label className="mt-2 flex items-center gap-2 text-[13px] text-accent-orange">
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
