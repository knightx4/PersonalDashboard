/**
 * What a price lookup saw, not just what it concluded.
 *
 * Both price sources used to return one integer, which made every number on
 * the page unanswerable: a $4 estimate and a $40 one looked equally certain,
 * and there was no way to tell a thin market from a bad match. The integer is
 * still what the router decides on — this is the evidence behind it, kept so
 * the item page can show the spread and link out to the listings themselves.
 *
 * One shape for both sources, because the panel should not care which one ran.
 * eBay fills `listings` with real listings; the web estimate fills it with the
 * pages it read, which carry no price of their own — hence the nullable
 * `priceCents`, which is the honest difference between a comp and a citation.
 */
import { z } from 'zod';

export const evidenceListingSchema = z.object({
  title: z.string().nullable().default(null),
  url: z.string().nullable().default(null),
  /** Null for a web-search source: it is a page that was read, not an offer. */
  priceCents: z.number().int().nonnegative().nullable().default(null),
  shippingCents: z.number().int().nonnegative().nullable().default(null),
  condition: z.string().nullable().default(null),
});

export type EvidenceListing = z.infer<typeof evidenceListingSchema>;

export const priceEvidenceSchema = z.object({
  source: z.enum(['ebay_browse', 'web_estimate']),
  /** The number the router uses. Always present. */
  typicalCents: z.number().int().nonnegative(),
  lowCents: z.number().int().nonnegative().nullable().default(null),
  highCents: z.number().int().nonnegative().nullable().default(null),
  medianCents: z.number().int().nonnegative().nullable().default(null),
  /** Listings actually read. Null when the source does not count in listings. */
  sampleSize: z.number().int().nonnegative().nullable().default(null),
  /** What eBay says matched overall — a liquidity signal, when it says. */
  totalMatches: z.number().int().nonnegative().nullable().default(null),
  listings: z.array(evidenceListingSchema).default([]),
  /** How typicalCents was derived, for the panel to explain itself. */
  typicalBasis: z.enum(['percentile', 'median']).nullable().default(null),
  /** One line on what the number rests on. */
  note: z.string().nullable().default(null),
  /** The search that produced this, so a bad match is visible as a bad query. */
  query: z.string().nullable().default(null),
  fetchedAt: z.string(),
});

export type PriceEvidence = z.infer<typeof priceEvidenceSchema>;

/**
 * Read evidence back out of a jsonb column.
 *
 * Anything unrecognised becomes null rather than throwing: a payload written by
 * an older deploy must not be able to take the item page down.
 */
export function parsePriceEvidence(raw: unknown): PriceEvidence | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = priceEvidenceSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * The percentile of asks taken as the price to act on.
 *
 * Asks run high, so it sits below the middle of the market — but only a little.
 * A quarter was too pessimistic: on a healthy listing page it named a price
 * near the bottom of what anyone was asking.
 */
export const TYPICAL_PERCENTILE = 0.4;

/**
 * At or below this many listings, the percentile is abandoned for the median.
 *
 * A percentile needs a distribution to be a percentile of. With three listings
 * the 40th lands on the cheapest, so one lowball sets the price for the item —
 * the median is the more robust answer when there is barely a market to read.
 * Five is the same threshold defaultNetFloorCents uses, for the same reason.
 */
export const THIN_MARKET_MAX = 4;

export type PriceStats = {
  count: number;
  minCents: number;
  /** The number to act on: a percentile normally, the median when thin. */
  typicalCents: number;
  medianCents: number;
  maxCents: number;
  /** Which rule produced typicalCents, so the panel can say. */
  typicalBasis: 'percentile' | 'median';
};

/** Nearest-rank order statistic, clamped. Integers in, integers out. */
function quantile(sorted: number[], q: number): number {
  return sorted[Math.max(0, Math.floor((sorted.length - 1) * q))]!;
}

/**
 * Order statistics over asking prices.
 *
 * These are what sellers want, not what buyers paid, so the number to act on
 * sits below the middle — see TYPICAL_PERCENTILE — except on a market too thin
 * to have a shape, where THIN_MARKET_MAX hands it to the median instead.
 */
export function priceStats(centsUnsorted: number[]): PriceStats | null {
  const cents = [...centsUnsorted].sort((a, b) => a - b);
  if (cents.length === 0) return null;

  const medianCents = quantile(cents, 0.5);
  const thin = cents.length <= THIN_MARKET_MAX;
  return {
    count: cents.length,
    minCents: cents[0]!,
    medianCents,
    maxCents: cents[cents.length - 1]!,
    typicalCents: thin ? medianCents : quantile(cents, TYPICAL_PERCENTILE),
    typicalBasis: thin ? 'median' : 'percentile',
  };
}

/** "$8.50–$34.00", or a single price when the spread is nil. */
export function formatRange(
  lowCents: number | null,
  highCents: number | null,
  format: (cents: number) => string,
): string | null {
  if (lowCents == null || highCents == null) return null;
  if (lowCents === highCents) return format(lowCents);
  return `${format(lowCents)}–${format(highCents)}`;
}
