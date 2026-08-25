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
import { createOpenLibraryProvider } from '@/lib/books/providers/open-library';
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
};

function defaultProviders(options: ResolveBookOptions): BookMetadataProvider[] {
  return [
    createGoogleBooksProvider({
      fetch: options.fetch,
      apiKey: options.googleBooksApiKey,
    }),
    createOpenLibraryProvider({ fetch: options.fetch }),
  ];
}

function hitToCanonical(
  hit: BookProviderHit,
  opts: { confidence: number; needsConfirmation: boolean },
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
  };
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
): Promise<BookProviderHit | null> {
  for (const provider of providers) {
    const hit = await provider.lookupByIsbn(isbn13);
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
): Promise<BookProviderHit[]> {
  const seen = new Set<string>();
  const merged: BookProviderHit[] = [];
  for (const provider of providers) {
    const hits = await provider.searchByTitle(title, author);
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
  const providers = options.providers ?? defaultProviders(options);

  if (isIsbnInput(input)) {
    const normalized = normalizeIsbn(input.isbn);
    if (!normalized) return null;
    const hit = await lookupIsbnAcrossProviders(normalized.isbn13, providers);
    if (!hit) return null;
    return hitToCanonical(hit, { confidence: 0.98, needsConfirmation: false });
  }

  const title = input.title?.trim();
  if (!title) return null;
  const author = input.author?.trim() || null;

  const hits = await searchTitleAcrossProviders(title, author, providers);
  if (hits.length === 0) return null;

  const scored = hits
    .map((hit) => ({ hit, score: titleScore(title, author, hit) }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0.25) return null;

  const plausibleCount = countPlausibleEditions(hits, 0.35, title, author);
  const needsConfirmation = plausibleCount > 1 || best.score < 0.75;

  return hitToCanonical(best.hit, {
    confidence: Number(best.score.toFixed(3)),
    needsConfirmation,
  });
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
