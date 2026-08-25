/**
 * Google Books API provider.
 *
 * Free with an optional API key. Prefer a key for batch shelf photos — the
 * unauthenticated courtesy quota is shared and too weak for 40 spines at once.
 */
import type { BookMetadataProvider, BookProviderHit } from '@/lib/books/types';
import { normalizeIsbn } from '@/lib/books/isbn';

type GoogleVolume = {
  volumeInfo?: {
    title?: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    industryIdentifiers?: { type?: string; identifier?: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
};

type GoogleListResponse = {
  totalItems?: number;
  items?: GoogleVolume[];
};

function yearFromDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/^(\d{4})/);
  if (!m) return null;
  const year = Number(m[1]);
  return year >= 1000 && year <= 2100 ? year : null;
}

function pickIdentifiers(volume: GoogleVolume): {
  isbn13: string | null;
  isbn10: string | null;
} {
  let isbn13: string | null = null;
  let isbn10: string | null = null;
  for (const id of volume.volumeInfo?.industryIdentifiers ?? []) {
    if (!id.identifier) continue;
    const normalized = normalizeIsbn(id.identifier);
    if (!normalized) continue;
    if (id.type === 'ISBN_13' || normalized.isbn13) isbn13 = normalized.isbn13;
    if (id.type === 'ISBN_10' || normalized.isbn10) isbn10 = normalized.isbn10;
  }
  if (isbn13 && !isbn10) {
    const n = normalizeIsbn(isbn13);
    isbn10 = n?.isbn10 ?? null;
  }
  if (isbn10 && !isbn13) {
    const n = normalizeIsbn(isbn10);
    isbn13 = n?.isbn13 ?? null;
  }
  return { isbn13, isbn10 };
}

function toHit(volume: GoogleVolume): BookProviderHit | null {
  const info = volume.volumeInfo;
  if (!info?.title?.trim()) return null;
  const { isbn13, isbn10 } = pickIdentifiers(volume);
  const cover =
    info.imageLinks?.thumbnail?.replace('http://', 'https://') ??
    info.imageLinks?.smallThumbnail?.replace('http://', 'https://') ??
    null;
  return {
    isbn13,
    isbn10,
    title: info.subtitle ? `${info.title}: ${info.subtitle}` : info.title.trim(),
    authors: (info.authors ?? []).map((a) => a.trim()).filter(Boolean),
    publisher: info.publisher?.trim() || null,
    publishedYear: yearFromDate(info.publishedDate),
    edition: null,
    coverUrl: cover,
    source: 'google_books',
  };
}

export type GoogleBooksOptions = {
  fetch?: typeof globalThis.fetch;
  apiKey?: string | null;
  baseUrl?: string;
};

export function createGoogleBooksProvider(
  options: GoogleBooksOptions = {},
): BookMetadataProvider {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? 'https://www.googleapis.com/books/v1/volumes';
  const apiKey = options.apiKey ?? null;

  async function list(query: string, maxResults = 10): Promise<BookProviderHit[]> {
    const url = new URL(baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', String(maxResults));
    if (apiKey) url.searchParams.set('key', apiKey);

    const res = await fetchFn(url.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as GoogleListResponse;
    if (!data.items?.length) return [];
    return data.items.map(toHit).filter((h): h is BookProviderHit => h !== null);
  }

  return {
    async lookupByIsbn(isbn13: string): Promise<BookProviderHit | null> {
      const hits = await list(`isbn:${isbn13}`, 5);
      const exact =
        hits.find((h) => h.isbn13 === isbn13) ??
        hits.find((h) => h.isbn10 && normalizeIsbn(h.isbn10)?.isbn13 === isbn13) ??
        hits[0] ??
        null;
      return exact;
    },

    async searchByTitle(title: string, author?: string | null): Promise<BookProviderHit[]> {
      const parts = [`intitle:${title.trim()}`];
      if (author?.trim()) parts.push(`inauthor:${author.trim()}`);
      return list(parts.join('+'), 10);
    },
  };
}
