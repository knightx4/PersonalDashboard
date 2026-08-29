/**
 * Sell-side fee and net math for books.
 *
 * ALL sell fee arithmetic lives here — never inline in components.
 * Numbers verified as of 2026-08-25; re-check before shipping.
 *
 * eBay Books & Magazines FVF: 15.3% of (item + shipping) up to $7,500, then
 * 2.35%; per-order $0.30 if total ≤ $10 else $0.40.
 * USPS Media Mail 1 lb retail: $4.39 (Notice 123 / usps.com, Jul 12 2026).
 */
import { assertIntegerCents } from '@/lib/money';

/** eBay Books & Magazines final value fee rate (no store), as of 2026-08. */
export const EBAY_BOOKS_FVF_RATE = 0.153;
/** Marginal rate above the $7,500 breakpoint. */
export const EBAY_BOOKS_FVF_RATE_ABOVE = 0.0235;
export const EBAY_FVF_BREAKPOINT_CENTS = 750_000;
/** Per-order fee when total amount ≤ $10. */
export const EBAY_PER_ORDER_FEE_LOW_CENTS = 30;
/** Per-order fee when total amount > $10. */
export const EBAY_PER_ORDER_FEE_HIGH_CENTS = 40;
export const EBAY_PER_ORDER_THRESHOLD_CENTS = 1000;

/**
 * USPS Media Mail retail, first pound. Flat estimate until weight_grams exists.
 * As of 2026-07-12: $4.39.
 */
export const MEDIA_MAIL_1LB_CENTS = 439;

/**
 * Flat shipping assumed for a board game, by explicit instruction: "I don't
 * really care about the shipping that much. Just assume $5."
 *
 * It is an assumption, not a rate. Media Mail above is a real published price
 * and legally cannot carry a board game; a real game parcel is 2-4 lb and would
 * cost more than this. So net_self for a game reads a little optimistic, and
 * the cheap fix if that ever matters is this one number.
 */
export const GAME_SHIP_FLAT_CENTS = 500;

/** Default effort penalty when the user has not set profiles.sell_effort_cents. */
export const DEFAULT_EFFORT_CENTS = 500;

/** Fallback net floor when the library is too small to percentile. */
export const DEFAULT_NET_FLOOR_CENTS = 1000;

export function ebayFinalValueFeeCents(totalAmountCents: number): number {
  assertIntegerCents(totalAmountCents);
  if (totalAmountCents <= 0) return 0;
  if (totalAmountCents <= EBAY_FVF_BREAKPOINT_CENTS) {
    return Math.round(totalAmountCents * EBAY_BOOKS_FVF_RATE);
  }
  const base = Math.round(EBAY_FVF_BREAKPOINT_CENTS * EBAY_BOOKS_FVF_RATE);
  const above = Math.round(
    (totalAmountCents - EBAY_FVF_BREAKPOINT_CENTS) * EBAY_BOOKS_FVF_RATE_ABOVE,
  );
  return base + above;
}

export function ebayPerOrderFeeCents(totalAmountCents: number): number {
  assertIntegerCents(totalAmountCents);
  if (totalAmountCents <= 0) return 0;
  return totalAmountCents <= EBAY_PER_ORDER_THRESHOLD_CENTS
    ? EBAY_PER_ORDER_FEE_LOW_CENTS
    : EBAY_PER_ORDER_FEE_HIGH_CENTS;
}

export type NetSelfInput = {
  expectedPriceCents: number;
  shippingCents?: number;
  effortCents?: number;
};

export type NetSelfBreakdown = {
  expectedPriceCents: number;
  shippingCents: number;
  fvfCents: number;
  perOrderFeeCents: number;
  effortCents: number;
  netCents: number;
};

/**
 * net_self = expected_price - FVF(price+shipping) - per-order fee - shipping - effort
 */
export function netSelf(input: NetSelfInput): NetSelfBreakdown {
  assertIntegerCents(input.expectedPriceCents);
  const shippingCents = input.shippingCents ?? MEDIA_MAIL_1LB_CENTS;
  const effortCents = input.effortCents ?? DEFAULT_EFFORT_CENTS;
  assertIntegerCents(shippingCents);
  assertIntegerCents(effortCents);
  const expectedPriceCents = input.expectedPriceCents;
  const totalAmountCents = expectedPriceCents + shippingCents;
  const fvfCents = ebayFinalValueFeeCents(totalAmountCents);
  const perOrderFeeCents = ebayPerOrderFeeCents(totalAmountCents);
  const netCents =
    expectedPriceCents - fvfCents - perOrderFeeCents - shippingCents - effortCents;
  return {
    expectedPriceCents,
    shippingCents,
    fvfCents,
    perOrderFeeCents,
    effortCents,
    netCents,
  };
}

export type NetBuybackInput = {
  quoteCents: number;
  shippingCents?: number;
};

/**
 * net_buyback = vendor_quote - buyback_shipping (often free label → 0).
 */
export function netBuyback(input: NetBuybackInput): {
  quoteCents: number;
  shippingCents: number;
  netCents: number;
} {
  assertIntegerCents(input.quoteCents);
  const shippingCents = input.shippingCents ?? 0;
  assertIntegerCents(shippingCents);
  return {
    quoteCents: input.quoteCents,
    shippingCents,
    netCents: input.quoteCents - shippingCents,
  };
}

/**
 * Default net floor from the library's net_self distribution.
 * Uses ~40th percentile when N >= 5; otherwise DEFAULT_NET_FLOOR_CENTS.
 */
export function defaultNetFloorCents(netSelfValues: readonly number[]): number {
  const positive = netSelfValues.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (positive.length < 5) return DEFAULT_NET_FLOOR_CENTS;
  const index = Math.max(0, Math.floor(positive.length * 0.4) - 1);
  const value = positive[index] ?? DEFAULT_NET_FLOOR_CENTS;
  return Math.max(0, Math.round(value));
}
