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
  pending,
}: {
  book: CanonicalBook;
  onSave: (forceConfirmed: boolean) => void;
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
            Multiple editions possible — confirm this is the right one before selling.
          </p>
        ) : (
          <p className="mt-2 text-[13px] text-brand">Exact match — sell-ready.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => onSave(true)}
          >
            {book.needsConfirmation ? 'Save & confirm edition' : 'Add to library'}
          </Button>
          {book.needsConfirmation && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => onSave(false)}
            >
              Save for later confirm
            </Button>
          )}
        </div>
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

  function saveBook(forceConfirmed: boolean) {
    if (!searchState.book) return;
    const fd = new FormData();
    fd.set('book_json', JSON.stringify(searchState.book));
    fd.set('force_confirmed', forceConfirmed ? 'true' : 'false');
    fd.set('source', 'manual');
    saveAction(fd);
  }

  return (
    <div className="flex flex-col gap-4">
      <form action={searchAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
      {searchState.book && (
        <BookCard book={searchState.book} onSave={saveBook} pending={savePending} />
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
