/**
 * Sell path router for confirmed items.
 *
 * Paths: list_individually | lot | buyback | donate
 * Unconfirmed editions must never reach this function.
 *
 * Not book-specific: shippingCents is a parameter and a null buyback quote is
 * an ordinary case, which is how board games route through here unchanged --
 * nothing buys those back, so they choose between listing, lotting and
 * donating.
 */
import { netBuyback, netSelf } from '@/lib/sell/pricing';

export type SellPath = 'list_individually' | 'lot' | 'buyback' | 'donate';

export type SellRouteInput = {
  /** Asking / expected self-list price; null when Browse has no data. */
  expectedSelfListCents: number | null;
  buybackQuoteCents: number | null;
  buybackShippingCents?: number;
  shippingCents?: number;
  effortCents?: number;
  netFloorCents: number;
};

export type SellRouteResult = {
  path: SellPath;
  netSelfCents: number | null;
  netBuybackCents: number | null;
  reason: string;
};

export function routeSellDecision(input: SellRouteInput): SellRouteResult {
  const floor = input.netFloorCents;

  const self =
    input.expectedSelfListCents != null
      ? netSelf({
          expectedPriceCents: input.expectedSelfListCents,
          shippingCents: input.shippingCents,
          effortCents: input.effortCents,
        })
      : null;

  const buyback =
    input.buybackQuoteCents != null
      ? netBuyback({
          quoteCents: input.buybackQuoteCents,
          shippingCents: input.buybackShippingCents ?? 0,
        })
      : null;

  const netSelfCents = self?.netCents ?? null;
  const netBuybackCents = buyback?.netCents ?? null;

  // Buyback wins when it clears the floor and beats (or ties) self-list net.
  if (
    netBuybackCents != null &&
    netBuybackCents >= floor &&
    (netSelfCents == null || netBuybackCents >= netSelfCents)
  ) {
    return {
      path: 'buyback',
      netSelfCents,
      netBuybackCents,
      reason: 'Firm buyback quote clears your floor with zero listing effort.',
    };
  }

  if (netSelfCents != null && netSelfCents >= floor) {
    return {
      path: 'list_individually',
      netSelfCents,
      netBuybackCents,
      reason: 'Self-list net clears your floor after fees, shipping, and effort.',
    };
  }

  // Low individual value: lot together (v1 = one bucket, no clustering).
  if (
    (netSelfCents != null && netSelfCents > 0 && netSelfCents < floor) ||
    (netBuybackCents != null && netBuybackCents > 0 && netBuybackCents < floor)
  ) {
    return {
      path: 'lot',
      netSelfCents,
      netBuybackCents,
      reason: 'Individual net is below your floor — better as part of a lot.',
    };
  }

  return {
    path: 'donate',
    netSelfCents,
    netBuybackCents,
    reason:
      'Near-zero resale value after costs. Consider donating (FMV hint is not tax advice).',
  };
}

/** Rough fair-market hint for donate path — labeled not tax advice in the UI. */
export function donateFmvHintCents(input: {
  expectedSelfListCents: number | null;
  buybackQuoteCents: number | null;
}): number {
  const candidates = [
    input.buybackQuoteCents,
    input.expectedSelfListCents != null
      ? Math.round(input.expectedSelfListCents * 0.25)
      : null,
  ].filter((n): n is number => n != null && n > 0);
  if (candidates.length === 0) return 0;
  return Math.min(...candidates);
}
