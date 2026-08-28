/**
 * When a cached price quote still counts as an answer.
 *
 * Two places ask this: the loader, deciding whether to show a price or spend a
 * lookup, and the "estimate prices" action, deciding which books to spend
 * lookups on. They used to answer it differently -- the loader asked whether
 * the row held a price, the action asked only whether a row existed -- and a
 * failed lookup leaves a row holding no price. So the page counted the book as
 * unpriced and offered to price it, the action counted it as priced and
 * refused, and the button could never do anything for the rest of the book's
 * life. Every quote row in the live database was in exactly that state.
 *
 * Hence one definition, in one place, used by both.
 */

/** The price sources a quote row can come from. */
export type QuoteSource = 'buyback' | 'ebay_browse' | 'web_estimate';

/** Buyback and eBay are cheap and move with the market. */
const QUOTE_TTL_MS = 1000 * 60 * 60 * 12; // 12h

/**
 * Web estimates are billed per lookup, and a used-book price does not move
 * meaningfully inside a month. Long cache, and never refreshed just because
 * someone opened the page.
 */
const WEB_ESTIMATE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

/** How long a quote from this source stands in for a live lookup. */
export function quoteTtlMs(source: QuoteSource): number {
  return source === 'web_estimate' ? WEB_ESTIMATE_TTL_MS : QUOTE_TTL_MS;
}

export type CachedQuote = {
  quoted_cents: number | null;
  fetched_at: string | null;
};

/**
 * True when this row can be used instead of asking the provider again.
 *
 * A row with no price is not an answer. The lookup found nothing, the book is
 * unpriced everywhere the user can see, and the only way it ever gets a price
 * is by asking again -- so it must not suppress the next attempt.
 */
export function quoteIsCurrent(
  quote: CachedQuote | null | undefined,
  source: QuoteSource,
  now: number = Date.now(),
): boolean {
  if (!quote || quote.quoted_cents == null || !quote.fetched_at) return false;
  const fetchedAt = new Date(quote.fetched_at).getTime();
  if (Number.isNaN(fetchedAt)) return false;
  return now - fetchedAt < quoteTtlMs(source);
}
