/**
 * Open Library API provider — free fallback and cross-check for Google Books.
 */
import type { BookMetadataProvider, BookProviderHit } from '@/lib/books/types';
import { normalizeIsbn } from '@/lib/books/isbn';

type OlBook = {
  title?: string;
  authors?: { name?: string; key?: string }[] | string[];
  publishers?: string[] | { name?: string }[];
  publish_date?: string;
  isbn_13?: string[];
  isbn_10?: string[];
  covers?: number[];
  number_of_pages?: number;
  edition_name?: string;
};

type OlSearchDoc = {
  title?: string;
  author_name?: string[];
  publisher?: string[];
  first_publish_year?: number;
  isbn?: string[];
  cover_i?: number;
  edition_key?: string[];
};

type OlSearchResponse = {
  docs?: OlSearchDoc[];
};

function yearFromDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/(\d{4})/);
  if (!m) return null;
  const year = Number(m[1]);
  return year >= 1000 && year <= 2100 ? year : null;
}

function coverUrlFromId(id: number | undefined): string | null {
  if (!id) return null;
  return `https://covers.openlibrary.org/b/id/${id}-M.jpg`;
}

function authorsFromBook(book: OlBook): string[] {
  if (!book.authors?.length) return [];
  return book.authors
    .map((a) => (typeof a === 'string' ? a : a.name ?? ''))
    .map((a) => a.trim())
    .filter(Boolean);
}

function publishersFromBook(book: OlBook): string | null {
  const first = book.publishers?.[0];
  if (!first) return null;
  if (typeof first === 'string') return first.trim() || null;
  return first.name?.trim() || null;
}

function toHitFromIsbnBook(book: OlBook): BookProviderHit | null {
  if (!book.title?.trim()) return null;
  const raw13 = book.isbn_13?.[0] ?? null;
  const raw10 = book.isbn_10?.[0] ?? null;
  const from13 = raw13 ? normalizeIsbn(raw13) : null;
  const from10 = raw10 ? normalizeIsbn(raw10) : null;
  return {
    isbn13: from13?.isbn13 ?? from10?.isbn13 ?? null,
    isbn10: from13?.isbn10 ?? from10?.isbn10 ?? null,
    title: book.title.trim(),
    authors: authorsFromBook(book),
    publisher: publishersFromBook(book),
    publishedYear: yearFromDate(book.publish_date),
    edition: book.edition_name?.trim() || null,
    coverUrl: coverUrlFromId(book.covers?.[0]),
    source: 'open_library',
  };
}

function toHitFromSearchDoc(doc: OlSearchDoc): BookProviderHit | null {
  if (!doc.title?.trim()) return null;
  let isbn13: string | null = null;
  let isbn10: string | null = null;
  for (const raw of doc.isbn ?? []) {
    const n = normalizeIsbn(raw);
    if (!n) continue;
    if (!isbn13) isbn13 = n.isbn13;
    if (!isbn10 && n.isbn10) isbn10 = n.isbn10;
  }
  return {
    isbn13,
    isbn10,
    title: doc.title.trim(),
    authors: (doc.author_name ?? []).map((a) => a.trim()).filter(Boolean),
    publisher: doc.publisher?.[0]?.trim() || null,
    publishedYear: doc.first_publish_year ?? null,
    edition: null,
    coverUrl: coverUrlFromId(doc.cover_i),
    source: 'open_library',
  };
}

export type OpenLibraryOptions = {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
};

export function createOpenLibraryProvider(
  options: OpenLibraryOptions = {},
): BookMetadataProvider {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const baseUrl = options.baseUrl ?? 'https://openlibrary.org';

  return {
    async lookupByIsbn(isbn13: string): Promise<BookProviderHit | null> {
      const url = `${baseUrl}/isbn/${isbn13}.json`;
      const res = await fetchFn(url, { headers: { Accept: 'application/json' } });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      const book = (await res.json()) as OlBook;
      const hit = toHitFromIsbnBook(book);
      if (hit && !hit.isbn13) {
        hit.isbn13 = isbn13;
        hit.isbn10 = normalizeIsbn(isbn13)?.isbn10 ?? null;
      }
      return hit;
    },

    async searchByTitle(title: string, author?: string | null): Promise<BookProviderHit[]> {
      const url = new URL(`${baseUrl}/search.json`);
      url.searchParams.set('title', title.trim());
      if (author?.trim()) url.searchParams.set('author', author.trim());
      url.searchParams.set('limit', '10');

      const res = await fetchFn(url.toString(), {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as OlSearchResponse;
      return (data.docs ?? [])
        .map(toHitFromSearchDoc)
        .filter((h): h is BookProviderHit => h !== null);
    },
  };
}
