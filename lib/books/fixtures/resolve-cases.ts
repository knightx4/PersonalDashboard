/**
 * Golden fixtures for the book resolver.
 * Each case has an input and the expected canonical fields we care about.
 * HTTP is mocked in the test — these do not hit the network.
 */
export type FixtureCase = {
  id: string;
  description: string;
  input: { isbn: string } | { title: string; author?: string };
  /** Mock provider responses keyed by provider behavior. */
  mocks: {
    googleIsbn?: Record<string, unknown> | null;
    openLibraryIsbn?: Record<string, unknown> | null;
    googleSearch?: Record<string, unknown> | null;
    openLibrarySearch?: Record<string, unknown> | null;
  };
  expected: {
    found: boolean;
    isbn13?: string | null;
    titleIncludes?: string;
    needsConfirmation?: boolean;
    minConfidence?: number;
    resolutionSource?: string;
  };
};

export const FIXTURES: FixtureCase[] = [
  {
    id: 'isbn-atomic-habits',
    description: 'Valid ISBN-13 resolves with high confidence, no confirmation',
    input: { isbn: '978-0-7352-1129-2' },
    mocks: {
      googleIsbn: {
        totalItems: 1,
        items: [
          {
            volumeInfo: {
              title: 'Atomic Habits',
              authors: ['James Clear'],
              publisher: 'Avery',
              publishedDate: '2018-10-16',
              industryIdentifiers: [
                { type: 'ISBN_13', identifier: '9780735211292' },
                { type: 'ISBN_10', identifier: '0735211299' },
              ],
              imageLinks: {
                thumbnail: 'https://books.google.com/covers/atomic.jpg',
              },
            },
          },
        ],
      },
    },
    expected: {
      found: true,
      isbn13: '9780735211292',
      titleIncludes: 'Atomic Habits',
      needsConfirmation: false,
      minConfidence: 0.9,
      resolutionSource: 'google_books',
    },
  },
  {
    id: 'isbn-10-converts',
    description: 'ISBN-10 input converts and looks up as ISBN-13',
    input: { isbn: '0-7352-1129-9' },
    mocks: {
      googleIsbn: {
        totalItems: 1,
        items: [
          {
            volumeInfo: {
              title: 'Atomic Habits',
              authors: ['James Clear'],
              industryIdentifiers: [
                { type: 'ISBN_13', identifier: '9780735211292' },
                { type: 'ISBN_10', identifier: '0735211299' },
              ],
            },
          },
        ],
      },
    },
    expected: {
      found: true,
      isbn13: '9780735211292',
      needsConfirmation: false,
    },
  },
  {
    id: 'isbn-fallback-open-library',
    description: 'Falls back to Open Library when Google misses',
    input: { isbn: '9780143127550' },
    mocks: {
      googleIsbn: { totalItems: 0, items: [] },
      openLibraryIsbn: {
        title: 'The Design of Everyday Things',
        authors: [{ name: 'Don Norman' }],
        publishers: ['Basic Books'],
        publish_date: '2013',
        isbn_13: ['9780143127550'],
        isbn_10: ['0143127550'],
        covers: [12345],
      },
    },
    expected: {
      found: true,
      isbn13: '9780143127550',
      titleIncludes: 'Design of Everyday Things',
      needsConfirmation: false,
      resolutionSource: 'open_library',
    },
  },
  {
    id: 'title-ambiguous-dune',
    description: 'Ambiguous title with multiple editions needs confirmation',
    input: { title: 'Dune', author: 'Frank Herbert' },
    mocks: {
      googleSearch: {
        totalItems: 3,
        items: [
          {
            volumeInfo: {
              title: 'Dune',
              authors: ['Frank Herbert'],
              publisher: 'Ace',
              publishedDate: '1990',
              industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780441172719' }],
            },
          },
          {
            volumeInfo: {
              title: 'Dune',
              authors: ['Frank Herbert'],
              publisher: 'Ace',
              publishedDate: '2019',
              industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780593099322' }],
            },
          },
          {
            volumeInfo: {
              title: 'Dune Messiah',
              authors: ['Frank Herbert'],
              industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780441172696' }],
            },
          },
        ],
      },
    },
    expected: {
      found: true,
      titleIncludes: 'Dune',
      needsConfirmation: true,
    },
  },
  {
    id: 'title-unique-match',
    description: 'Unique title/author match can skip confirmation when score is high',
    input: { title: 'Atomic Habits', author: 'James Clear' },
    mocks: {
      googleSearch: {
        totalItems: 1,
        items: [
          {
            volumeInfo: {
              title: 'Atomic Habits',
              authors: ['James Clear'],
              publisher: 'Avery',
              publishedDate: '2018',
              industryIdentifiers: [{ type: 'ISBN_13', identifier: '9780735211292' }],
            },
          },
        ],
      },
    },
    expected: {
      found: true,
      isbn13: '9780735211292',
      needsConfirmation: false,
      minConfidence: 0.75,
    },
  },
  {
    id: 'garbage-isbn',
    description: 'Invalid ISBN returns null',
    input: { isbn: '12345' },
    mocks: {},
    expected: { found: false },
  },
  {
    id: 'empty-title',
    description: 'Empty title returns null',
    input: { title: '   ' },
    mocks: {},
    expected: { found: false },
  },
];
