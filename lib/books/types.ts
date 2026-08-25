/**
 * Canonical book record produced by the resolution engine.
 *
 * Edition is where book value lives. An ISBN fixes the edition; a title search
 * often does not, which is why needsConfirmation flips on for ambiguous matches.
 */

export type BookResolutionSource =
  | 'google_books'
  | 'open_library'
  | 'isbndb'
  | 'manual';

export type CanonicalBook = {
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  authors: string[];
  publisher: string | null;
  publishedYear: number | null;
  edition: string | null;
  coverUrl: string | null;
  /** Always null in v1 — ISBNdb is deferred. */
  weightGrams: number | null;
  matchConfidence: number;
  needsConfirmation: boolean;
  resolutionSource: BookResolutionSource;
};

export type ResolveByIsbnInput = {
  isbn: string;
};

export type ResolveByTitleInput = {
  title: string;
  author?: string | null;
};

export type ResolveBookInput = ResolveByIsbnInput | ResolveByTitleInput;

export function isIsbnInput(input: ResolveBookInput): input is ResolveByIsbnInput {
  return 'isbn' in input && typeof input.isbn === 'string';
}

export type BookProviderHit = {
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  authors: string[];
  publisher: string | null;
  publishedYear: number | null;
  edition: string | null;
  coverUrl: string | null;
  source: BookResolutionSource;
};

export type BookMetadataProvider = {
  lookupByIsbn(isbn13: string): Promise<BookProviderHit | null>;
  searchByTitle(title: string, author?: string | null): Promise<BookProviderHit[]>;
};
