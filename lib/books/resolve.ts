/**
 * Book resolution engine.
 *
 * Pure-ish: injectable providers and fetch. Input is an ISBN or a title/author
 * string. Output is a canonical book record. ISBN hits are sell-ready
 * (needsConfirmation = false). Title hits may need a confirm tap when more
 * than one plausible edition exists.
 */
import { normalizeIsbn } from '@/lib/books/isbn';
import { createGoogleBooksProvider } from '@/lib/books/providers/google-books';
import { createIsbndbProvider } from '@/lib/books/providers/isbndb';
import { createOpenLibraryProvider } from '@/lib/books/providers/open-library';
import { ProviderError, type ProviderFailure } from '@/lib/books/providers/http';
import {
  isIsbnInput,
  type BookMetadataProvider,
  type BookProviderHit,
  type CanonicalBook,
  type ResolveBookInput,
} from '@/lib/books/types';
import { normalize as normalizeName } from '@/lib/fingerprint';

export type ResolveBookOptions = {
  providers?: BookMetadataProvider[];
  fetch?: typeof globalThis.fetch;
  googleBooksApiKey?: string | null;
  isbndbApiKey?: string | null;
};

/**
 * A resolve attempt, including the providers that could not answer. An empty
 * book with no failures means "no catalog has it"; an empty book with
 * failures means "ask again later" — very different things to tell a user.
 */
export type ResolveOutcome = {
  book: CanonicalBook | null;
  failures: ProviderFailure[];
};

function defaultProviders(options: ResolveBookOptions): BookMetadataProvider[] {
  const providers: BookMetadataProvider[] = [];
  // ISBNdb first when configured: it has this week's releases, which is
  // exactly where the free catalogs come up empty.
  if (options.isbndbApiKey) {
    providers.push(
      createIsbndbProvider({ apiKey: options.isbndbApiKey, fetch: options.fetch }),
    );
  }
  providers.push(
    createGoogleBooksProvider({
      fetch: options.fetch,
      apiKey: options.googleBooksApiKey,
    }),
    createOpenLibraryProvider({ fetch: options.fetch }),
  );
  return providers;
}

function hitToCanonical(
  hit: BookProviderHit,
  opts: {
    confidence: number;
    needsConfirmation: boolean;
    alternates?: BookProviderHit[];
    confirmationReason?: string | null;
  },
): CanonicalBook {
  return {
    isbn13: hit.isbn13,
    isbn10: hit.isbn10,
    title: hit.title,
    authors: hit.authors,
    publisher: hit.publisher,
    publishedYear: hit.publishedYear,
    edition: hit.edition,
    coverUrl: hit.coverUrl,
    weightGrams: null,
    matchConfidence: opts.confidence,
    needsConfirmation: opts.needsConfirmation,
    resolutionSource: hit.source,
    alternates: opts.alternates ?? [],
    confirmationReason: opts.confirmationReason ?? null,
  };
}

/** Stable identity for an edition: ISBN when known, else title+publisher+year. */
function editionKey(hit: BookProviderHit): string {
  if (hit.isbn13) return hit.isbn13;
  return `${normalizeName(hit.title)}|${hit.publisher ?? ''}|${hit.publishedYear ?? ''}`;
}

/** What to tell the user when we cannot pin the edition ourselves. */
function confirmationReasonFor(opts: {
  title: string;
  editionCount: number;
  score: number;
}): string | null {
  if (opts.editionCount > 1) {
    return `${opts.editionCount} editions match “${opts.title}”. Printings differ in publisher, year, and binding, and buyback prices are quoted per ISBN — so pick the one on your shelf.`;
  }
  if (opts.score < 0.75) {
    return `Closest title match scored ${Math.round(opts.score * 100)}%. Check the author, publisher, and year below against your copy.`;
  }
  return null;
}

function titleScore(queryTitle: string, queryAuthor: string | null | undefined, hit: BookProviderHit): number {
  const qt = normalizeName(queryTitle);
  const ht = normalizeName(hit.title);
  if (!qt || !ht) return 0;
  let score = 0;
  if (qt === ht) score += 0.7;
  else if (ht.includes(qt) || qt.includes(ht)) score += 0.45;
  else {
    const qWords = new Set(qt.split(' '));
    const hWords = ht.split(' ');
    const overlap = hWords.filter((w) => qWords.has(w)).length;
    score += Math.min(0.4, (overlap / Math.max(qWords.size, 1)) * 0.4);
  }

  if (queryAuthor?.trim()) {
    const qa = normalizeName(queryAuthor);
    const authors = hit.authors.map(normalizeName).join(' ');
    if (authors.includes(qa) || qa.includes(authors)) score += 0.25;
    else {
      const aWords = new Set(qa.split(' '));
      const overlap = authors.split(' ').filter((w) => aWords.has(w)).length;
      score += Math.min(0.2, (overlap / Math.max(aWords.size, 1)) * 0.2);
    }
  } else {
    score += 0.05;
  }

  if (hit.isbn13) score += 0.05;
  return Math.min(1, score);
}

/** Distinct editions: different ISBN, or same title with different year/publisher. */
function countPlausibleEditions(hits: BookProviderHit[], minScore: number, queryTitle: string, queryAuthor?: string | null): number {
  const plausible = hits.filter((h) => titleScore(queryTitle, queryAuthor, h) >= minScore);
  const isbns = new Set(
    plausible.map((h) => h.isbn13).filter((v): v is string => Boolean(v)),
  );
  if (isbns.size > 1) return isbns.size;
  if (isbns.size === 1) return 1;
  // No ISBNs — treat distinct publisher+year as separate editions.
  const keys = new Set(
    plausible.map((h) => `${h.publisher ?? ''}|${h.publishedYear ?? ''}|${normalizeName(h.title)}`),
  );
  return keys.size;
}

async function lookupIsbnAcrossProviders(
  isbn13: string,
  providers: BookMetadataProvider[],
  failures: ProviderFailure[],
): Promise<BookProviderHit | null> {
  for (const provider of providers) {
    let hit: BookProviderHit | null = null;
    try {
      hit = await provider.lookupByIsbn(isbn13);
    } catch (error) {
      // One provider being rate-limited must not end the lookup — but it also
      // must not be reported as "this book does not exist".
      if (error instanceof ProviderError) {
        failures.push(error.failure);
        continue;
      }
      throw error;
    }
    if (hit) {
      if (!hit.isbn13) hit.isbn13 = isbn13;
      if (!hit.isbn10) hit.isbn10 = normalizeIsbn(isbn13)?.isbn10 ?? null;
      return hit;
    }
  }
  return null;
}

async function searchTitleAcrossProviders(
  title: string,
  author: string | null | undefined,
  providers: BookMetadataProvider[],
  failures: ProviderFailure[],
): Promise<BookProviderHit[]> {
  const seen = new Set<string>();
  const merged: BookProviderHit[] = [];
  for (const provider of providers) {
    let hits: BookProviderHit[] = [];
    try {
      hits = await provider.searchByTitle(title, author);
    } catch (error) {
      if (error instanceof ProviderError) {
        failures.push(error.failure);
        continue;
      }
      throw error;
    }
    for (const hit of hits) {
      const key = hit.isbn13 ?? `${normalizeName(hit.title)}|${hit.authors.join(',')}|${hit.publishedYear}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(hit);
    }
  }
  return merged;
}

/**
 * Resolve an ISBN or title/author to a canonical book record.
 * Returns null when nothing usable is found.
 */
export async function resolveBook(
  input: ResolveBookInput,
  options: ResolveBookOptions = {},
): Promise<CanonicalBook | null> {
  const { book } = await resolveBookDetailed(input, options);
  return book;
}

/**
 * Resolve, and say what went wrong when nothing came back. Callers that face
 * a user should prefer this: "no catalog has this ISBN yet" and "Google Books
 * is rate-limiting us" need different words and different next steps.
 */
export async function resolveBookDetailed(
  input: ResolveBookInput,
  options: ResolveBookOptions = {},
): Promise<ResolveOutcome> {
  const providers = options.providers ?? defaultProviders(options);
  const failures: ProviderFailure[] = [];

  if (isIsbnInput(input)) {
    const normalized = normalizeIsbn(input.isbn);
    if (!normalized) return { book: null, failures };
    const hit = await lookupIsbnAcrossProviders(normalized.isbn13, providers, failures);
    if (!hit) return { book: null, failures };
    const book = hitToCanonical(hit, {
      confidence: 0.98,
      needsConfirmation: false,
      alternates: [],
      confirmationReason: null,
    });
    return { book, failures };
  }

  const title = input.title?.trim();
  if (!title) return { book: null, failures };
  const author = input.author?.trim() || null;

  const hits = await searchTitleAcrossProviders(title, author, providers, failures);
  if (hits.length === 0) return { book: null, failures };

  const scored = hits
    .map((hit) => ({ hit, score: titleScore(title, author, hit) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0.25) return { book: null, failures };

  const plausibleCount = countPlausibleEditions(hits, 0.35, title, author);
  const needsConfirmation = plausibleCount > 1 || best.score < 0.75;

  // Runner-ups the user can pick instead, best first, one row per edition.
  const seenEditions = new Set([editionKey(best.hit)]);
  const alternates: BookProviderHit[] = [];
  for (const { hit, score } of scored.slice(1)) {
    if (score < 0.35) continue;
    const key = editionKey(hit);
    if (seenEditions.has(key)) continue;
    seenEditions.add(key);
    alternates.push(hit);
    if (alternates.length >= 4) break;
  }

  return {
    book: hitToCanonical(best.hit, {
      confidence: Number(best.score.toFixed(3)),
      needsConfirmation,
      alternates: needsConfirmation ? alternates : [],
      confirmationReason: needsConfirmation
        ? confirmationReasonFor({
            title: best.hit.title,
            editionCount: plausibleCount,
            score: best.score,
          })
        : null,
    }),
    failures,
  };
}

/**
 * Resolve many candidates with a concurrency cap (shelf photo fan-out).
 */
export async function resolveBooks(
  inputs: readonly ResolveBookInput[],
  options: ResolveBookOptions & { concurrency?: number } = {},
): Promise<(CanonicalBook | null)[]> {
  const { mapPool } = await import('@/lib/async/map-pool');
  return mapPool(inputs, options.concurrency ?? 3, (input) => resolveBook(input, options));
}
