/**
 * The one way to ask a price source a question.
 *
 * There are three callers — the shelf-wide run, the single-item "Price it"
 * button, and the ad-hoc "Search" button — and they used to each reach for the
 * provider themselves. When the sources learned to return the listings behind
 * a number, only one of the three was taught to ask for them, so the item page
 * that the feature was built for still showed a bare figure. One function now,
 * so the next capability cannot land in one caller and miss two.
 *
 * The evidence method replaces the number method, never runs alongside it: a
 * web estimate is billed per lookup, and asking twice would double the bill.
 */
import type { ExpectedPriceSource, PriceSubject } from '@/lib/sell/expected-price';
import type { PriceEvidence } from '@/lib/sell/price-evidence';

export type PriceLookup = {
  /** What the router decides on. Null when nothing usable came back. */
  cents: number | null;
  /** The spread and the listings, when the source keeps them. */
  evidence: PriceEvidence | null;
};

const EMPTY: PriceLookup = { cents: null, evidence: null };

/** Price a book by its ISBN — the strongest query any source can be given. */
export async function lookupPriceByIsbn(
  provider: ExpectedPriceSource,
  isbn13: string,
): Promise<PriceLookup> {
  if (provider.priceEvidenceForIsbn) {
    const evidence = await provider.priceEvidenceForIsbn(isbn13);
    return evidence ? { cents: evidence.typicalCents, evidence } : EMPTY;
  }
  return { cents: await provider.expectedSelfListCents(isbn13), evidence: null };
}

/** Price anything else: a game, or an item known only by its name. */
export async function lookupPriceBySubject(
  provider: ExpectedPriceSource,
  subject: PriceSubject,
): Promise<PriceLookup> {
  if (provider.priceEvidence) {
    const evidence = await provider.priceEvidence(subject);
    return evidence ? { cents: evidence.typicalCents, evidence } : EMPTY;
  }
  return { cents: await provider.expectedSelfListCentsFor(subject), evidence: null };
}
