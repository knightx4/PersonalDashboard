/**
 * Turn book-shaped inventory units into real book rows.
 *
 * Email ingestion writes generic inventory_items; the sell assistant only sees
 * a unit once it has book_details with an ISBN. This bridges the two: detect
 * book lines, resolve them, and write book_details alongside the unit. Every
 * failure here is soft — an order import must never fail because Google Books
 * was slow.
 */
import 'server-only';

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { mapPool } from '@/lib/async/map-pool';
import { bookHintFromOrderLine } from '@/lib/books/from-order-line';
import { resolveBookDetailed } from '@/lib/books/resolve';
import type { CanonicalBook } from '@/lib/books/types';

/** Book lookups are third-party HTTP; keep the fan-out small. */
const RESOLVE_CONCURRENCY = 2;

export type InventoryLineForBooks = {
  inventoryItemId: string;
  name: string;
  variant?: string | null;
  productUrl?: string | null;
  categorySlug?: string | null;
  imageUrl?: string | null;
  searchTags?: readonly string[] | null;
};

export type AttachBooksResult = {
  attached: number;
  unresolved: number;
  skipped: number;
};

async function booksCategoryId(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase
    .from('categories')
    .select('id')
    .eq('slug', 'books')
    .is('user_id', null)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/** Inventory ids that already carry book_details — never resolve those twice. */
async function alreadyDetailed(
  supabase: SupabaseClient,
  inventoryItemIds: string[],
): Promise<Set<string>> {
  if (inventoryItemIds.length === 0) return new Set();
  const { data } = await supabase
    .from('book_details')
    .select('inventory_item_id')
    .in('inventory_item_id', inventoryItemIds);
  return new Set((data ?? []).map((row) => row.inventory_item_id as string));
}

/**
 * Resolve the book lines among these inventory units and write book_details.
 * ISBN-derived rows are sell-ready; title-derived rows land needing a confirm.
 */
export async function attachBookDetailsForInventory(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    lines: InventoryLineForBooks[];
    googleBooksApiKey?: string | null;
    isbndbApiKey?: string | null;
    /** Marks the rows as machine-created (order email) rather than captured. */
    autoImported?: boolean;
  },
): Promise<AttachBooksResult> {
  const result: AttachBooksResult = { attached: 0, unresolved: 0, skipped: 0 };

  const hinted = opts.lines
    .map((line) => ({ line, hint: bookHintFromOrderLine(line) }))
    .filter((entry): entry is { line: InventoryLineForBooks; hint: NonNullable<typeof entry.hint> } =>
      entry.hint !== null,
    );

  result.skipped = opts.lines.length - hinted.length;
  if (hinted.length === 0) return result;

  const existing = await alreadyDetailed(
    supabase,
    hinted.map((entry) => entry.line.inventoryItemId),
  );
  const pending = hinted.filter((entry) => !existing.has(entry.line.inventoryItemId));
  result.skipped += hinted.length - pending.length;
  if (pending.length === 0) return result;

  const categoryId = await booksCategoryId(supabase);

  const providerKeys = {
    googleBooksApiKey: opts.googleBooksApiKey,
    isbndbApiKey: opts.isbndbApiKey,
  };

  const resolved = await mapPool(pending, RESOLVE_CONCURRENCY, async (entry) => {
    try {
      const outcome = await resolveBookDetailed(
        entry.hint.kind === 'isbn'
          ? { isbn: entry.hint.isbn13 }
          : { title: entry.hint.title, author: entry.hint.author },
        providerKeys,
      );
      // A rate-limited catalog leaves no row, so the next scan retries it —
      // better than writing a book with no ISBN and calling it done.
      if (!outcome.book && outcome.failures.length > 0) {
        console.warn(
          'book lookup unavailable',
          entry.line.inventoryItemId,
          outcome.failures,
        );
      }
      return { entry, book: outcome.book as CanonicalBook | null };
    } catch (error) {
      console.error('book resolve failed', entry.line.inventoryItemId, error);
      return { entry, book: null };
    }
  });

  for (const { entry, book } of resolved) {
    if (!book) {
      result.unresolved += 1;
      continue;
    }

    // The ISBN came off the product the user actually bought, so the edition
    // is settled; a title match is a guess until they say otherwise.
    const needsConfirmation =
      entry.hint.kind === 'isbn' ? false : (book.needsConfirmation ?? true);

    const { error } = await supabase.from('book_details').insert({
      id: randomUUID(),
      inventory_item_id: entry.line.inventoryItemId,
      isbn_13: book.isbn13,
      isbn_10: book.isbn10,
      authors: book.authors,
      edition: book.edition,
      publisher: book.publisher,
      published_year: book.publishedYear,
      weight_grams: book.weightGrams,
      condition: null,
      resolution_source: book.resolutionSource,
      match_confidence: book.matchConfidence,
      needs_confirmation: needsConfirmation,
      candidates: needsConfirmation ? (book.alternates ?? []) : [],
      confirmation_reason: needsConfirmation ? (book.confirmationReason ?? null) : null,
      auto_imported: opts.autoImported ?? true,
    });

    if (error) {
      // Unique violation = another sync attached it first; not a failure.
      if (!/duplicate|unique/i.test(error.message)) {
        console.error('book_details insert failed', entry.line.inventoryItemId, error.message);
      }
      result.skipped += 1;
      continue;
    }

    await enrichInventoryUnit(supabase, {
      userId: opts.userId,
      line: entry.line,
      book,
      booksCategoryId: categoryId,
    });
    result.attached += 1;
  }

  return result;
}

/**
 * Fill in what the email could not: the books category, a cover image, and the
 * ISBN as a search tag. Never overwrites values the user can already see.
 */
async function enrichInventoryUnit(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    line: InventoryLineForBooks;
    book: CanonicalBook;
    booksCategoryId: string | null;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {};

  const { data: current } = await supabase
    .from('inventory_items')
    .select('category_id, image_url, search_tags')
    .eq('id', opts.line.inventoryItemId)
    .eq('user_id', opts.userId)
    .maybeSingle();
  if (!current) return;

  if (!current.category_id && opts.booksCategoryId) {
    patch.category_id = opts.booksCategoryId;
  }
  if (!current.image_url && opts.book.coverUrl) {
    patch.image_url = opts.book.coverUrl;
  }

  const tags = new Set(((current.search_tags as string[] | null) ?? []).map((t) => t.toLowerCase()));
  const before = tags.size;
  tags.add('book');
  tags.add('books');
  if (opts.book.isbn13) tags.add(opts.book.isbn13);
  for (const author of opts.book.authors) tags.add(author.toLowerCase());
  if (tags.size !== before) patch.search_tags = [...tags];

  if (Object.keys(patch).length === 0) return;

  const { error } = await supabase
    .from('inventory_items')
    .update(patch)
    .eq('id', opts.line.inventoryItemId)
    .eq('user_id', opts.userId);
  if (error) {
    console.error('inventory book enrich failed', opts.line.inventoryItemId, error.message);
  }
}
