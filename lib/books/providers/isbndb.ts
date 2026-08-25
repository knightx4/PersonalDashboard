/**
 * ISBNdb provider — the paid catalog, and the only one of the three that
 * reliably carries a book published this month. Enabled when ISBNDB_API_KEY
 * is set; the resolver simply skips it otherwise.
 */
import type { BookMetadataProvider, BookProviderHit } from '@/lib/books/types';
import { normalizeIsbn } from '@/lib/books/isbn';
import { getJson } from '@/lib/books/providers/http';

type IsbndbBook = {
  isbn13?: string;
  isbn?: string;
  title?: string;
  title_long?: string;
  authors?: string[];
  publisher?: string;
  date_published?: string;
  edition?: string;
  image?: string;
};

type IsbndbBookResponse = { book?: IsbndbBook };
type IsbndbSearchResponse = { books?: IsbndbBook[] };

function yearFrom(raw: string | undefined): number | null {
  const match = raw?.match(/(\d{4})/);
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1000 && year <= 2100 ? year : null;
}

function toHit(book: IsbndbBook): BookProviderHit | null {
  const title = (book.title_long ?? book.title)?.trim();
  if (!title) return null;
  const normalized = normalizeIsbn(book.isbn13 ?? book.isbn ?? '');
  return {
    isbn13: normalized?.isbn13 ?? null,
    isbn10: normalized?.isbn10 ?? null,
    title,
    authors: (book.authors ?? []).map((a) => a.trim()).filter(Boolean),
    publisher: book.publisher?.trim() || null,
    publishedYear: yearFrom(book.date_published),
    edition: book.edition?.trim() || null,
    coverUrl: book.image?.trim() || null,
    source: 'isbndb',
  };
}

export type IsbndbOptions = {
  apiKey: string;
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
};

export function createIsbndbProvider(options: IsbndbOptions): BookMetadataProvider {
  const baseUrl = options.baseUrl ?? 'https://api2.isbndb.com';
  const request = { provider: 'isbndb', fetch: options.fetch, headers: { Authorization: options.apiKey } };

  return {
    async lookupByIsbn(isbn13: string): Promise<BookProviderHit | null> {
      const data = await getJson<IsbndbBookResponse>(`${baseUrl}/book/${isbn13}`, request);
      if (!data?.book) return null;
      const hit = toHit(data.book);
      if (hit && !hit.isbn13) {
        hit.isbn13 = isbn13;
        hit.isbn10 = normalizeIsbn(isbn13)?.isbn10 ?? null;
      }
      return hit;
    },

    async searchByTitle(title: string, author?: string | null): Promise<BookProviderHit[]> {
      const query = [title.trim(), author?.trim()].filter(Boolean).join(' ');
      const data = await getJson<IsbndbSearchResponse>(
        `${baseUrl}/books/${encodeURIComponent(query)}?pageSize=10`,
        request,
      );
      return (data?.books ?? [])
        .map(toHit)
        .filter((h): h is BookProviderHit => h !== null);
    },
  };
}
