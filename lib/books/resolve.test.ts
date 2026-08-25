import { describe, expect, it } from 'vitest';
import {
  extractIsbnFromText,
  isbn10To13,
  isbn13To10,
  isValidIsbn10,
  isValidIsbn13,
  normalizeIsbn,
  stripIsbn,
} from '@/lib/books/isbn';
import { FIXTURES } from '@/lib/books/fixtures/resolve-cases';
import { resolveBook } from '@/lib/books/resolve';
import type { BookMetadataProvider, BookProviderHit } from '@/lib/books/types';
import { createGoogleBooksProvider } from '@/lib/books/providers/google-books';
import { createOpenLibraryProvider } from '@/lib/books/providers/open-library';

describe('isbn utils', () => {
  it('strips hyphens and spaces', () => {
    expect(stripIsbn('978-0-7352-1129-2')).toBe('9780735211292');
    expect(stripIsbn('0 7352 1129 9')).toBe('0735211299');
  });

  it('validates ISBN-10 and ISBN-13', () => {
    expect(isValidIsbn13('9780735211292')).toBe(true);
    expect(isValidIsbn10('0735211299')).toBe(true);
    expect(isValidIsbn13('9780735211293')).toBe(false);
    expect(isValidIsbn10('0735211290')).toBe(false);
  });

  it('converts ISBN-10 ↔ ISBN-13', () => {
    expect(isbn10To13('0735211299')).toBe('9780735211292');
    expect(isbn13To10('9780735211292')).toBe('0735211299');
  });

  it('normalizeIsbn returns both forms', () => {
    expect(normalizeIsbn('978-0735211292')).toEqual({
      isbn13: '9780735211292',
      isbn10: '0735211299',
    });
    expect(normalizeIsbn('0735211299')).toEqual({
      isbn13: '9780735211292',
      isbn10: '0735211299',
    });
    expect(normalizeIsbn('not-an-isbn')).toBeNull();
  });

  it('extracts ISBN from free text', () => {
    expect(extractIsbnFromText('ISBN: 978-0-7352-1129-2 Atomic Habits')).toBe(
      '9780735211292',
    );
  });
});

function mockFetchForCase(mocks: (typeof FIXTURES)[number]['mocks']): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('googleapis.com/books')) {
      if (url.includes('q=isbn')) {
        const body = mocks.googleIsbn ?? { totalItems: 0, items: [] };
        return new Response(JSON.stringify(body), { status: 200 });
      }
      const body = mocks.googleSearch ?? { totalItems: 0, items: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    if (url.includes('openlibrary.org/isbn/')) {
      if (mocks.openLibraryIsbn === null) {
        return new Response('Not found', { status: 404 });
      }
      if (mocks.openLibraryIsbn) {
        return new Response(JSON.stringify(mocks.openLibraryIsbn), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }
    if (url.includes('openlibrary.org/search.json')) {
      const body = mocks.openLibrarySearch ?? { docs: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response('unexpected', { status: 500 });
  };
}

describe('resolveBook fixtures', () => {
  for (const fixture of FIXTURES) {
    it(fixture.description, async () => {
      const result = await resolveBook(fixture.input, {
        fetch: mockFetchForCase(fixture.mocks),
      });

      if (!fixture.expected.found) {
        expect(result).toBeNull();
        return;
      }

      expect(result).not.toBeNull();
      if (!result) return;

      if (fixture.expected.isbn13 !== undefined) {
        expect(result.isbn13).toBe(fixture.expected.isbn13);
      }
      if (fixture.expected.titleIncludes) {
        expect(result.title).toContain(fixture.expected.titleIncludes);
      }
      if (fixture.expected.needsConfirmation !== undefined) {
        expect(result.needsConfirmation).toBe(fixture.expected.needsConfirmation);
      }
      if (fixture.expected.minConfidence !== undefined) {
        expect(result.matchConfidence).toBeGreaterThanOrEqual(
          fixture.expected.minConfidence,
        );
      }
      if (fixture.expected.resolutionSource) {
        expect(result.resolutionSource).toBe(fixture.expected.resolutionSource);
      }
      expect(result.weightGrams).toBeNull();
    });
  }
});

describe('resolveBook with stub providers', () => {
  it('prefers the first provider that returns an ISBN hit', async () => {
    const hit: BookProviderHit = {
      isbn13: '9780735211292',
      isbn10: '0735211299',
      title: 'Atomic Habits',
      authors: ['James Clear'],
      publisher: 'Avery',
      publishedYear: 2018,
      edition: null,
      coverUrl: null,
      source: 'google_books',
    };
    const google: BookMetadataProvider = {
      lookupByIsbn: async () => hit,
      searchByTitle: async () => [],
    };
    const openLib: BookMetadataProvider = {
      lookupByIsbn: async () => {
        throw new Error('should not be called');
      },
      searchByTitle: async () => [],
    };

    const result = await resolveBook(
      { isbn: '9780735211292' },
      { providers: [google, openLib] },
    );
    expect(result?.title).toBe('Atomic Habits');
    expect(result?.needsConfirmation).toBe(false);
  });
});

describe('provider factories', () => {
  it('createGoogleBooksProvider parses a volume list', async () => {
    const provider = createGoogleBooksProvider({
      fetch: async () =>
        new Response(
          JSON.stringify({
            totalItems: 1,
            items: [
              {
                volumeInfo: {
                  title: 'Test',
                  authors: ['A'],
                  industryIdentifiers: [
                    { type: 'ISBN_13', identifier: '9780735211292' },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        ),
    });
    const hit = await provider.lookupByIsbn('9780735211292');
    expect(hit?.title).toBe('Test');
  });

  it('createOpenLibraryProvider handles 404', async () => {
    const provider = createOpenLibraryProvider({
      fetch: async () => new Response('missing', { status: 404 }),
    });
    expect(await provider.lookupByIsbn('9780735211292')).toBeNull();
  });
});
