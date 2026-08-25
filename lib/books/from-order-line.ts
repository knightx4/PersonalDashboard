/**
 * Decide whether an order line is a book, and with what identity.
 *
 * Pure: no network, no database. Email ingestion runs every imported line
 * through this before spending a resolver call, so it has to be cheap and
 * quiet about false positives — a model number that happens to pass the
 * ISBN-10 checksum must not turn a phone case into a paperback.
 */
import { extractIsbnFromText, normalizeIsbn } from '@/lib/books/isbn';

export type OrderLineForBooks = {
  name: string;
  variant?: string | null;
  productUrl?: string | null;
  categorySlug?: string | null;
  searchTags?: readonly string[] | null;
};

export type BookLineHint =
  | { kind: 'isbn'; isbn13: string; title: string }
  | { kind: 'title'; title: string; author: string | null };

const BOOK_WORDS =
  /\b(paperback|hardcover|hardback|mass market|library binding|board book|boxed set|a novel|isbn|audiobook|book|books)\b/i;

/** Formats that are not a physical unit we could ever ship to a buyback vendor. */
const NON_PHYSICAL =
  /\b(kindle edition|ebook|e-book|audible|audio ?download|digital)\b/i;

const FORMAT_SUFFIX =
  /[\s([-]+(paperback|hardcover|hardback|mass market(?: paperback)?|library binding|board book|illustrated(?: edition)?|reprint(?: edition)?|\d+(?:st|nd|rd|th) edition)\s*[)\]]?\s*$/i;

const AMAZON_ASIN_RE = /amazon\.[a-z.]+\/(?:.*?\/)?(?:dp|gp\/product)\/([A-Z0-9]{10})/i;

/** Amazon book ASINs are the ISBN-10 — a free, exact edition id when valid. */
export function isbnFromProductUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const asin = url.match(AMAZON_ASIN_RE)?.[1];
  if (!asin) return null;
  return normalizeIsbn(asin)?.isbn13 ?? null;
}

/** Category, tags, or wording that says “this is a book”. */
export function looksLikeBookLine(line: OrderLineForBooks): boolean {
  if (line.categorySlug === 'books') return true;
  const tags = (line.searchTags ?? []).map((tag) => tag.toLowerCase());
  if (tags.includes('book') || tags.includes('books')) return true;
  return BOOK_WORDS.test(`${line.name} ${line.variant ?? ''}`);
}

/** Trim retailer format noise and split a trailing “by Author”. */
export function cleanBookTitle(raw: string): { title: string; author: string | null } {
  let title = raw.trim().replace(/\s+/g, ' ');
  let author: string | null = null;

  const byMatch = title.match(/^(.*?)[\s,:]+by\s+([^,;|]+)$/i);
  if (byMatch?.[1] && byMatch[2]) {
    title = byMatch[1].trim();
    author = byMatch[2].trim();
  }

  // Retailers append the binding; drop it (repeatedly — “(Paperback) - Reprint”).
  let previous = '';
  while (previous !== title) {
    previous = title;
    title = title.replace(FORMAT_SUFFIX, '').trim();
  }
  title = title.replace(/[\s,:;|(-]+$/, '').trim();

  return { title, author };
}

/**
 * What to hand the resolver for this line, or null when it is not a book we
 * can act on. ISBN hints pin the exact printing the user bought; title hints
 * still need a human confirm before they drive a sell decision.
 */
export function bookHintFromOrderLine(line: OrderLineForBooks): BookLineHint | null {
  const blob = `${line.name} ${line.variant ?? ''}`;
  if (NON_PHYSICAL.test(blob)) return null;

  const urlIsbn = isbnFromProductUrl(line.productUrl);
  const bookish = looksLikeBookLine(line);

  // An ASIN that is a valid ISBN-10 is Amazon telling us it is a book.
  if (urlIsbn) return { kind: 'isbn', isbn13: urlIsbn, title: line.name.trim() };

  if (!bookish) return null;

  // Only trust digits inside a title when the line already reads as a book.
  const textIsbn = extractIsbnFromText(blob);
  if (textIsbn) return { kind: 'isbn', isbn13: textIsbn, title: line.name.trim() };

  const { title, author } = cleanBookTitle(line.name);
  if (title.length < 3) return null;
  return { kind: 'title', title, author };
}
