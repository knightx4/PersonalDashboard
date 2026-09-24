'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { buildOwnedBookRows } from '@/lib/books/create-owned-book';
import { resolvePasteList } from '@/lib/books/paste-list';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { resolveBook, resolveBookDetailed } from '@/lib/books/resolve';
import type { ProviderFailure } from '@/lib/books/providers/http';
import { normalizeIsbn } from '@/lib/books/isbn';
import type { BookEditionCandidate, CanonicalBook } from '@/lib/books/types';
import { enrichItemDisplay } from '@/lib/inventory/enrich-display';
import { serverEnv } from '@/lib/env';
import { todayInTimezone } from '@/lib/money';

export type BookActionState = {
  error?: string;
  message?: string;
  book?: CanonicalBook | null;
  /**
   * Set when the lookup failed for a reason other than "no such book" — the
   * UI says "try again" instead of sending the user off to doubt their scan.
   */
  lookupFailed?: boolean;
  /** Valid ISBN we could not resolve; prefills the by-hand form. */
  manualIsbn?: string | null;
  results?: {
    raw: string;
    book: CanonicalBook | null;
    error?: string;
  }[];
  savedIds?: string[];
};

async function booksCategoryId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const { data } = await supabase
    .from('categories')
    .select('id')
    .eq('slug', 'books')
    .is('user_id', null)
    .maybeSingle();
  return data?.id ?? null;
}

async function userTimezone(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string> {
  const { data } = await supabase.from('profiles').select('timezone').eq('id', userId).single();
  return data?.timezone ?? 'UTC';
}

function envKeys() {
  try {
    const env = serverEnv();
    return {
      anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
      googleBooksApiKey: env.GOOGLE_BOOKS_API_KEY ?? null,
      isbndbApiKey: env.ISBNDB_API_KEY ?? null,
    };
  } catch {
    return {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
      googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY ?? null,
      isbndbApiKey: process.env.ISBNDB_API_KEY ?? null,
    };
  }
}

const bookCandidateSchema = z.object({
  isbn13: z.string().nullable(),
  isbn10: z.string().nullable(),
  title: z.string().min(1),
  authors: z.array(z.string()),
  publisher: z.string().nullable(),
  publishedYear: z.number().int().nullable(),
  edition: z.string().nullable(),
  coverUrl: z.string().nullable(),
  source: z.enum(['google_books', 'open_library', 'isbndb', 'manual']),
});

const canonicalBookSchema = z.object({
  isbn13: z.string().nullable(),
  isbn10: z.string().nullable(),
  title: z.string().min(1),
  authors: z.array(z.string()),
  publisher: z.string().nullable(),
  publishedYear: z.number().int().nullable(),
  edition: z.string().nullable(),
  coverUrl: z.string().nullable(),
  weightGrams: z.number().int().nullable(),
  matchConfidence: z.number(),
  needsConfirmation: z.boolean(),
  resolutionSource: z.enum(['google_books', 'open_library', 'isbndb', 'manual']),
  alternates: z.array(bookCandidateSchema).optional().default([]),
  confirmationReason: z.string().nullable().optional().default(null),
});

/** Turn provider trouble into something a person can act on. */
function lookupFailureMessage(failures: ProviderFailure[]): string | null {
  if (failures.length === 0) return null;
  if (failures.some((f) => f.kind === 'rate_limited')) {
    return 'The book catalogs are rate-limiting us right now, so this is not a verdict on your book. Try again in a minute — setting GOOGLE_BOOKS_API_KEY (free) makes this rare.';
  }
  if (failures.some((f) => f.kind === 'unauthorized')) {
    return 'A book catalog rejected our credentials. Check GOOGLE_BOOKS_API_KEY / ISBNDB_API_KEY.';
  }
  return 'The book catalogs did not answer just now. Try again, or add the details by hand.';
}

// latency: pending
export async function searchOwnedBook(
  _prev: BookActionState,
  formData: FormData,
): Promise<BookActionState> {
  await requireUser();
  const query = String(formData.get('query') ?? '').trim();
  if (!query) return { error: 'Enter an ISBN or a title.' };

  const keys = envKeys();
  const providerKeys = {
    googleBooksApiKey: keys.googleBooksApiKey,
    isbndbApiKey: keys.isbndbApiKey,
  };
  const isbn = normalizeIsbn(query);
  const failures: ProviderFailure[] = [];

  if (isbn) {
    const byIsbn = await resolveBookDetailed({ isbn: isbn.isbn13 }, providerKeys);
    failures.push(...byIsbn.failures);
    if (byIsbn.book) return { book: byIsbn.book, message: 'Match found.' };
  }

  // A scanned ISBN that no catalog carries is still worth a title attempt only
  // when the user typed words; digits make a useless title query.
  if (!isbn) {
    const byTitle = await resolveBookDetailed({ title: query }, providerKeys);
    failures.push(...byTitle.failures);
    if (byTitle.book) return { book: byTitle.book, message: 'Match found.' };
  }

  const failureMessage = lookupFailureMessage(failures);
  if (failureMessage) {
    return {
      error: failureMessage,
      book: null,
      lookupFailed: true,
      manualIsbn: isbn?.isbn13 ?? null,
    };
  }

  return {
    error: isbn
      ? 'No catalog lists this ISBN yet. New releases often take weeks to appear — add the details by hand and we will keep the ISBN so pricing still works.'
      : 'No matching book found. Try the ISBN from the back cover, or add the details by hand.',
    book: null,
    manualIsbn: isbn?.isbn13 ?? null,
  };
}

// latency: pending
export async function saveOwnedBook(
  _prev: BookActionState,
  formData: FormData,
): Promise<BookActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  let book: CanonicalBook;
  const rawJson = String(formData.get('book_json') ?? '');
  if (rawJson) {
    const parsed = canonicalBookSchema.safeParse(JSON.parse(rawJson));
    if (!parsed.success) return { error: 'Invalid book payload.' };
    book = parsed.data;
  } else {
    const query = String(formData.get('query') ?? '').trim();
    if (!query) return { error: 'Nothing to save.' };
    const keys = envKeys();
    const resolved = await resolveBook(
      { isbn: query },
      { googleBooksApiKey: keys.googleBooksApiKey },
    );
    if (!resolved) return { error: 'Could not resolve that book.' };
    book = resolved;
  }

  const forceConfirmed = String(formData.get('force_confirmed') ?? '') === 'true';
  const sourceRaw = String(formData.get('source') ?? 'manual');
  const source =
    sourceRaw === 'photo' || sourceRaw === 'receipt_photo' ? sourceRaw : 'manual';

  const categoryId = await booksCategoryId(supabase);
  if (!categoryId) return { error: 'Books category is missing from the database.' };

  const timezone = await userTimezone(supabase, user.id);
  const bundle = buildOwnedBookRows({
    userId: user.id,
    booksCategoryId: categoryId,
    book,
    acquiredAt: todayInTimezone(timezone),
    source,
    forceConfirmed,
  });

  const { error: invError } = await supabase.from('inventory_items').insert({
    id: bundle.inventory.id,
    user_id: bundle.inventory.userId,
    order_item_id: null,
    category_id: bundle.inventory.categoryId,
    name: bundle.inventory.name,
    short_name: bundle.inventory.shortName,
    variant: bundle.inventory.variant,
    image_url: bundle.inventory.imageUrl,
    fingerprint_loose: bundle.inventory.fingerprintLoose,
    acquired_at: bundle.inventory.acquiredAt,
    cost_cents: bundle.inventory.costCents,
    search_tags: bundle.inventory.searchTags,
    source: bundle.inventory.source,
    status: bundle.inventory.status,
  });
  if (invError) return { error: invError.message };

  const { error: bookError } = await supabase.from('book_details').insert({
    id: bundle.bookDetails.id,
    inventory_item_id: bundle.bookDetails.inventoryItemId,
    isbn_13: bundle.bookDetails.isbn13,
    isbn_10: bundle.bookDetails.isbn10,
    authors: bundle.bookDetails.authors,
    edition: bundle.bookDetails.edition,
    publisher: bundle.bookDetails.publisher,
    published_year: bundle.bookDetails.publishedYear,
    weight_grams: bundle.bookDetails.weightGrams,
    condition: bundle.bookDetails.condition,
    resolution_source: bundle.bookDetails.resolutionSource,
    match_confidence: bundle.bookDetails.matchConfidence,
    needs_confirmation: bundle.bookDetails.needsConfirmation,
    candidates: bundle.bookDetails.candidates,
    confirmation_reason: bundle.bookDetails.confirmationReason,
    auto_imported: false,
  });
  if (bookError) {
    await supabase.from('inventory_items').delete().eq('id', bundle.inventory.id);
    return { error: bookError.message };
  }

  revalidatePath('/shopping/inventory');
  revalidatePath('/shopping/sell');
  return {
    message: bundle.bookDetails.needsConfirmation
      ? 'Added to your library — confirm the edition before selling.'
      : 'Added to your library.',
    savedIds: [bundle.inventory.id],
    book,
  };
}

// latency: pending
export async function previewPasteBookList(
  _prev: BookActionState,
  formData: FormData,
): Promise<BookActionState> {
  const user = await requireUser();
  const text = String(formData.get('paste') ?? '');
  if (!text.trim()) return { error: 'Paste at least one book.' };

  const keys = envKeys();
  const spend: SpendReport[] = [];
  const results = await resolvePasteList(text, {
    anthropicApiKey: keys.anthropicApiKey,
    googleBooksApiKey: keys.googleBooksApiKey,
    onSpend: (report) => spend.push(report),
  });
  await recordSessionSpend(user.id, { module: 'shopping', operation: 'parse-paste-list' }, spend);
  return { results, message: `Resolved ${results.filter((r) => r.book).length} of ${results.length}.` };
}

// latency: pending
export async function savePasteBookList(
  _prev: BookActionState,
  formData: FormData,
): Promise<BookActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const raw = String(formData.get('books_json') ?? '');
  if (!raw) return { error: 'Nothing to save.' };

  let books: CanonicalBook[];
  try {
    const parsed = z.array(canonicalBookSchema).safeParse(JSON.parse(raw));
    if (!parsed.success) return { error: 'Invalid book list.' };
    books = parsed.data;
  } catch {
    return { error: 'Invalid book list JSON.' };
  }

  // Only persist rows the user marked as selected; ambiguous ones need
  // force_confirmed ids listed separately.
  const selectedIndexes = new Set(
    formData
      .getAll('selected')
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n >= 0),
  );
  const confirmedIndexes = new Set(
    formData
      .getAll('confirmed')
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n >= 0),
  );

  const categoryId = await booksCategoryId(supabase);
  if (!categoryId) return { error: 'Books category is missing from the database.' };

  const timezone = await userTimezone(supabase, user.id);
  const acquiredAt = todayInTimezone(timezone);
  const savedIds: string[] = [];
  const sourceRaw = String(formData.get('source') ?? 'manual');
  const source =
    sourceRaw === 'photo' || sourceRaw === 'receipt_photo' ? sourceRaw : 'manual';

  for (let i = 0; i < books.length; i++) {
    if (!selectedIndexes.has(i)) continue;
    const book = books[i]!;
    if (book.needsConfirmation && !confirmedIndexes.has(i)) continue;

    const bundle = buildOwnedBookRows({
      userId: user.id,
      booksCategoryId: categoryId,
      book,
      acquiredAt,
      source,
      forceConfirmed: confirmedIndexes.has(i) || !book.needsConfirmation,
    });

    const { error: invError } = await supabase.from('inventory_items').insert({
      id: bundle.inventory.id,
      user_id: bundle.inventory.userId,
      order_item_id: null,
      category_id: bundle.inventory.categoryId,
      name: bundle.inventory.name,
      short_name: bundle.inventory.shortName,
      variant: bundle.inventory.variant,
      image_url: bundle.inventory.imageUrl,
      fingerprint_loose: bundle.inventory.fingerprintLoose,
      acquired_at: bundle.inventory.acquiredAt,
      cost_cents: 0,
      search_tags: bundle.inventory.searchTags,
      source,
      status: 'owned',
    });
    if (invError) return { error: invError.message, savedIds };

    const { error: bookError } = await supabase.from('book_details').insert({
      id: bundle.bookDetails.id,
      inventory_item_id: bundle.bookDetails.inventoryItemId,
      isbn_13: bundle.bookDetails.isbn13,
      isbn_10: bundle.bookDetails.isbn10,
      authors: bundle.bookDetails.authors,
      edition: bundle.bookDetails.edition,
      publisher: bundle.bookDetails.publisher,
      published_year: bundle.bookDetails.publishedYear,
      weight_grams: null,
      condition: null,
      resolution_source: bundle.bookDetails.resolutionSource,
      match_confidence: bundle.bookDetails.matchConfidence,
      needs_confirmation: false,
      candidates: [],
      confirmation_reason: null,
      auto_imported: false,
    });
    if (bookError) return { error: bookError.message, savedIds };
    savedIds.push(bundle.inventory.id);
  }

  revalidatePath('/shopping/inventory');
  revalidatePath('/shopping/sell');
  return {
    message: savedIds.length ? `Saved ${savedIds.length} book(s).` : 'No books selected.',
    savedIds,
  };
}

// latency: pending
export async function confirmBookEdition(
  _prev: BookActionState,
  formData: FormData,
): Promise<BookActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const id = z.string().uuid().safeParse(formData.get('inventory_item_id'));
  if (!id.success) return { error: 'Missing item.' };

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) return { error: 'Item not found.' };

  const { error } = await supabase
    .from('book_details')
    .update({
      needs_confirmation: false,
      candidates: [],
      confirmation_reason: null,
    })
    .eq('inventory_item_id', item.id);
  if (error) return { error: error.message };

  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${item.id}`);
  revalidatePath('/shopping/sell');
  return { message: 'Edition confirmed — ready for sell decisions.' };
}

// latency: pending
export async function updateBookCondition(
  _prev: BookActionState,
  formData: FormData,
): Promise<BookActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const id = z.string().uuid().safeParse(formData.get('inventory_item_id'));
  if (!id.success) return { error: 'Missing item.' };

  const condition = z
    .enum(['new', 'like_new', 'very_good', 'good', 'acceptable'])
    .nullable()
    .or(z.literal('').transform(() => null))
    .safeParse(formData.get('condition') || null);
  if (!condition.success) return { error: 'Invalid condition.' };

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) return { error: 'Item not found.' };

  const { error } = await supabase
    .from('book_details')
    .update({ condition: condition.data })
    .eq('inventory_item_id', item.id);
  if (error) return { error: error.message };

  revalidatePath(`/shopping/inventory/${item.id}`);
  revalidatePath('/shopping/sell');
  return { message: 'Condition saved.' };
}


/**
 * Swap this unit onto one of the runner-up editions the resolver offered.
 * Re-looks-up by ISBN when the candidate has one so the row gets full detail,
 * then clears the confirm prompt — the user has now told us the edition.
 */
// latency: pending
export async function switchBookEdition(
  _prev: BookActionState,
  formData: FormData,
): Promise<BookActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('inventory_item_id'));
  if (!id.success) return { error: 'Missing item.' };

  let candidate: BookEditionCandidate;
  try {
    const parsed = bookCandidateSchema.safeParse(
      JSON.parse(String(formData.get('candidate_json') ?? '')),
    );
    if (!parsed.success) return { error: 'Invalid edition payload.' };
    candidate = parsed.data;
  } catch {
    return { error: 'Invalid edition payload.' };
  }

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id, search_tags')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) return { error: 'Item not found.' };

  const keys = envKeys();
  const resolved = candidate.isbn13
    ? await resolveBook(
        { isbn: candidate.isbn13 },
        { googleBooksApiKey: keys.googleBooksApiKey },
      )
    : null;

  const book: CanonicalBook = resolved ?? {
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
  };

  const { error: bookError } = await supabase
    .from('book_details')
    .update({
      isbn_13: book.isbn13,
      isbn_10: book.isbn10,
      authors: book.authors,
      edition: book.edition,
      publisher: book.publisher,
      published_year: book.publishedYear,
      weight_grams: book.weightGrams,
      resolution_source: book.resolutionSource,
      match_confidence: 1,
      needs_confirmation: false,
      candidates: [],
      confirmation_reason: null,
    })
    .eq('inventory_item_id', item.id);
  if (bookError) return { error: bookError.message };

  const authorsLabel = book.authors.length > 0 ? book.authors.join(', ') : null;
  const enriched = enrichItemDisplay({
    name: book.title,
    variant: authorsLabel,
    categorySlug: 'books',
    categoryName: 'Books',
    searchTags: [
      'book',
      'books',
      ...(book.isbn13 ? [book.isbn13] : []),
      ...book.authors.map((a) => a.toLowerCase()),
    ],
  });

  const { error: invError } = await supabase
    .from('inventory_items')
    .update({
      name: book.title,
      short_name: enriched.shortName,
      variant: authorsLabel,
      search_tags: enriched.searchTags,
      ...(book.coverUrl ? { image_url: book.coverUrl } : {}),
    })
    .eq('id', item.id)
    .eq('user_id', user.id);
  if (invError) return { error: invError.message };

  revalidatePath('/shopping/inventory');
  revalidatePath(`/shopping/inventory/${item.id}`);
  revalidatePath('/shopping/sell');
  return { message: `Switched to the ${[book.publisher, book.publishedYear].filter(Boolean).join(' ') || 'selected'} edition.` };
}


/**
 * Add a book the catalogs do not carry yet.
 *
 * Brand-new releases can be weeks away from Google Books or Open Library, and
 * the barcode is still a perfectly good edition id. Typed details plus the
 * scanned ISBN make a sell-ready unit: buyback and eBay both quote by ISBN,
 * so pricing works even with no catalog record behind it.
 */
// latency: pending
export async function saveManualBook(
  _prev: BookActionState,
  formData: FormData,
): Promise<BookActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const title = String(formData.get('title') ?? '').trim();
  if (!title) return { error: 'Title is required.' };

  const rawIsbn = String(formData.get('isbn') ?? '').trim();
  const isbn = rawIsbn ? normalizeIsbn(rawIsbn) : null;
  if (rawIsbn && !isbn) {
    return { error: 'That ISBN failed its check digit — re-scan or retype it.' };
  }

  const yearRaw = String(formData.get('published_year') ?? '').trim();
  const publishedYear = yearRaw ? Number(yearRaw) : null;
  if (
    publishedYear != null &&
    (!Number.isInteger(publishedYear) || publishedYear < 1000 || publishedYear > 2100)
  ) {
    return { error: 'Year must be a four-digit year.' };
  }

  const book: CanonicalBook = {
    isbn13: isbn?.isbn13 ?? null,
    isbn10: isbn?.isbn10 ?? null,
    title,
    authors: String(formData.get('authors') ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
    publisher: String(formData.get('publisher') ?? '').trim() || null,
    publishedYear,
    edition: String(formData.get('edition') ?? '').trim() || null,
    coverUrl: null,
    weightGrams: null,
    matchConfidence: 1,
    // The user is holding the book. Nothing left to confirm.
    needsConfirmation: false,
    resolutionSource: 'manual',
    alternates: [],
    confirmationReason: null,
  };

  const categoryId = await booksCategoryId(supabase);
  if (!categoryId) return { error: 'Books category is missing from the database.' };

  const timezone = await userTimezone(supabase, user.id);
  const bundle = buildOwnedBookRows({
    userId: user.id,
    booksCategoryId: categoryId,
    book,
    acquiredAt: todayInTimezone(timezone),
    source: 'manual',
    forceConfirmed: true,
  });

  const { error: invError } = await supabase.from('inventory_items').insert({
    id: bundle.inventory.id,
    user_id: bundle.inventory.userId,
    order_item_id: null,
    category_id: bundle.inventory.categoryId,
    name: bundle.inventory.name,
    short_name: bundle.inventory.shortName,
    variant: bundle.inventory.variant,
    image_url: bundle.inventory.imageUrl,
    fingerprint_loose: bundle.inventory.fingerprintLoose,
    acquired_at: bundle.inventory.acquiredAt,
    cost_cents: bundle.inventory.costCents,
    search_tags: bundle.inventory.searchTags,
    source: bundle.inventory.source,
    status: bundle.inventory.status,
  });
  if (invError) return { error: invError.message };

  const { error: bookError } = await supabase.from('book_details').insert({
    id: bundle.bookDetails.id,
    inventory_item_id: bundle.bookDetails.inventoryItemId,
    isbn_13: bundle.bookDetails.isbn13,
    isbn_10: bundle.bookDetails.isbn10,
    authors: bundle.bookDetails.authors,
    edition: bundle.bookDetails.edition,
    publisher: bundle.bookDetails.publisher,
    published_year: bundle.bookDetails.publishedYear,
    weight_grams: null,
    condition: null,
    resolution_source: 'manual',
    match_confidence: 1,
    needs_confirmation: false,
    candidates: [],
    confirmation_reason: null,
    auto_imported: false,
  });
  if (bookError) {
    await supabase.from('inventory_items').delete().eq('id', bundle.inventory.id);
    return { error: bookError.message };
  }

  revalidatePath('/shopping/inventory');
  revalidatePath('/shopping/sell');
  return {
    message: book.isbn13
      ? 'Added by hand with your ISBN — pricing will still work.'
      : 'Added by hand. Add an ISBN later to unlock buyback quotes.',
    savedIds: [bundle.inventory.id],
    book,
  };
}
