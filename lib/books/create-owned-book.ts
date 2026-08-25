/**
 * Persist a resolved book as a standalone inventory unit + book_details row.
 * Pure builder: no database. Server actions call this then insert.
 */
import { randomUUID } from 'node:crypto';
import { fingerprintLoose } from '@/lib/fingerprint';
import { enrichItemDisplay } from '@/lib/inventory/enrich-display';
import type { CanonicalBook } from '@/lib/books/types';

export type OwnedBookSource = 'manual' | 'photo' | 'receipt_photo';

export type OwnedBookInventoryRow = {
  id: string;
  userId: string;
  orderItemId: null;
  categoryId: string;
  name: string;
  shortName: string;
  variant: string | null;
  imageUrl: string | null;
  fingerprintLoose: string;
  acquiredAt: string;
  costCents: number;
  searchTags: string[];
  source: OwnedBookSource;
  status: 'owned';
};

export type OwnedBookDetailsRow = {
  id: string;
  inventoryItemId: string;
  isbn13: string | null;
  isbn10: string | null;
  authors: string[];
  edition: string | null;
  publisher: string | null;
  publishedYear: number | null;
  weightGrams: number | null;
  condition: null;
  resolutionSource: CanonicalBook['resolutionSource'];
  matchConfidence: number;
  needsConfirmation: boolean;
};

export type OwnedBookBundle = {
  inventory: OwnedBookInventoryRow;
  bookDetails: OwnedBookDetailsRow;
};

export function buildOwnedBookRows(input: {
  userId: string;
  booksCategoryId: string;
  book: CanonicalBook;
  acquiredAt: string;
  source?: OwnedBookSource;
  /** Force confirmation off after a user taps “this is the right edition”. */
  forceConfirmed?: boolean;
}): OwnedBookBundle {
  const inventoryId = randomUUID();
  const authorsLabel =
    input.book.authors.length > 0 ? input.book.authors.join(', ') : null;
  const enriched = enrichItemDisplay({
    name: input.book.title,
    variant: authorsLabel,
    categorySlug: 'books',
    categoryName: 'Books',
    searchTags: [
      'book',
      'books',
      ...(input.book.isbn13 ? [input.book.isbn13] : []),
      ...input.book.authors.map((a) => a.toLowerCase()),
    ],
  });

  const needsConfirmation = input.forceConfirmed
    ? false
    : input.book.needsConfirmation;

  return {
    inventory: {
      id: inventoryId,
      userId: input.userId,
      orderItemId: null,
      categoryId: input.booksCategoryId,
      name: input.book.title,
      shortName: enriched.shortName,
      variant: authorsLabel,
      imageUrl: input.book.coverUrl,
      fingerprintLoose: fingerprintLoose(
        input.book.isbn13 ?? input.book.title,
      ),
      acquiredAt: input.acquiredAt,
      costCents: 0,
      searchTags: enriched.searchTags,
      source: input.source ?? 'manual',
      status: 'owned',
    },
    bookDetails: {
      id: randomUUID(),
      inventoryItemId: inventoryId,
      isbn13: input.book.isbn13,
      isbn10: input.book.isbn10,
      authors: input.book.authors,
      edition: input.book.edition,
      publisher: input.book.publisher,
      publishedYear: input.book.publishedYear,
      weightGrams: input.book.weightGrams,
      condition: null,
      resolutionSource: input.book.resolutionSource,
      matchConfidence: input.book.matchConfidence,
      needsConfirmation,
    },
  };
}
