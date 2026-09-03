/**
 * The sell queue: everything marked for sale, priced from cache and routed.
 *
 * Nothing here spends a lookup. Opening the page is free — a price appears
 * because someone pressed a price button at some point, or typed a number
 * themselves — which is what lets the same page carry a billed source without
 * a page view costing money.
 *
 * An item with no price at all is not routed. Sending it to `donate` because
 * the router saw no number would be a recommendation made out of ignorance, so
 * it stays in its own group with nothing but a price button.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { BuybackQuote } from '@/lib/sell/buyback';
import { expectedPriceSourceKind } from '@/lib/sell/expected-price';
import {
  loadForSaleItems,
  priceTargetOf,
  type SellItemKind,
} from '@/lib/sell/for-sale';
import {
  DEFAULT_EFFORT_CENTS,
  defaultNetFloorCents,
  netSelf,
  shippingCentsForKind,
} from '@/lib/sell/pricing';
import { quoteIsCurrent, type CachedQuote } from '@/lib/sell/quote-cache';
import { donateFmvHintCents, routeSellDecision, type SellPath } from '@/lib/sell/route';
import { serverEnv } from '@/lib/env';

export type SellQueueRow = {
  inventoryItemId: string;
  name: string;
  shortName: string | null;
  imageUrl: string | null;
  kind: SellItemKind;
  /** Authors, or publisher and year, or the category — whatever it has. */
  subtitle: string | null;
  costCents: number;
  needsConfirmation: boolean;
  expectedSelfListCents: number | null;
  priceIsManual: boolean;
  /** A looked-up price past its ttl: still shown, and labelled. */
  priceIsStale: boolean;
  /** Null when there is no price yet, and so nothing to route on. */
  path: SellPath | null;
  reason: string | null;
  netSelfCents: number | null;
  netBuybackCents: number | null;
  buyback: BuybackQuote | null;
  donateFmvCents: number;
};

export type SellQueue = {
  rows: SellQueueRow[];
  netFloorCents: number;
  effortCents: number;
  priceSource: ReturnType<typeof expectedPriceSourceKind>;
  /** Rows carrying no price — what "price everything" would cover. */
  unpricedCount: number;
  /** Rows whose edition is unsettled, priced by title until it is. */
  needsConfirmationCount: number;
};

/** Same shape and same fallback as the rest of lib/sell — see item-quote.ts. */
function envKeys() {
  try {
    const env = serverEnv();
    return {
      ebayClientId: env.EBAY_CLIENT_ID ?? null,
      ebayClientSecret: env.EBAY_CLIENT_SECRET ?? null,
      anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
    };
  } catch {
    return {
      ebayClientId: process.env.EBAY_CLIENT_ID ?? null,
      ebayClientSecret: process.env.EBAY_CLIENT_SECRET ?? null,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
    };
  }
}

function subtitleOf(item: {
  kind: SellItemKind;
  authors: string[];
  isbn13: string | null;
  publisher: string | null;
  yearPublished: number | null;
  categoryName: string | null;
}): string | null {
  if (item.kind === 'book') {
    const parts = [item.authors.join(', '), item.isbn13].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'Book';
  }
  if (item.kind === 'game') {
    return (
      [item.publisher, item.yearPublished].filter(Boolean).join(' · ') || 'Board game'
    );
  }
  return item.categoryName;
}

export async function loadSellQueue(input: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<SellQueue> {
  const { supabase, userId } = input;
  const priceSource = expectedPriceSourceKind(envKeys());

  const [{ data: profile }, items] = await Promise.all([
    supabase
      .from('profiles')
      .select('sell_net_floor_cents, sell_effort_cents')
      .eq('id', userId)
      .single(),
    loadForSaleItems({ supabase, userId }),
  ]);

  const effortCents = profile?.sell_effort_cents ?? DEFAULT_EFFORT_CENTS;

  const targets = new Map(items.map((item) => [item.inventoryItemId, priceTargetOf(item)]));
  const isbns = [...new Set([...targets.values()].flatMap((t) => (t.via === 'isbn' ? [t.isbn13] : [])))];
  const bggIds = [...new Set([...targets.values()].flatMap((t) => (t.via === 'bgg' ? [t.bggId] : [])))];
  const itemIds = [...targets.values()].flatMap((t) =>
    t.via === 'item' ? [t.inventoryItemId] : [],
  );

  const none = { data: [] as Record<string, unknown>[] };
  const [bookQuotes, gameQuotes, itemQuotes, buybackQuotes] = await Promise.all([
    priceSource !== 'none' && isbns.length > 0
      ? supabase
          .from('book_price_quotes')
          .select('isbn_13, quoted_cents, fetched_at')
          .eq('source', priceSource)
          .in('isbn_13', isbns)
      : none,
    priceSource !== 'none' && bggIds.length > 0
      ? supabase
          .from('game_price_quotes')
          .select('bgg_id, quoted_cents, fetched_at')
          .eq('source', priceSource)
          .in('bgg_id', bggIds)
      : none,
    priceSource !== 'none' && itemIds.length > 0
      ? supabase
          .from('item_price_quotes')
          .select('inventory_item_id, quoted_cents, fetched_at')
          .eq('source', priceSource)
          .in('inventory_item_id', itemIds)
      : none,
    // Buyback is a book-only path and is read from cache like everything else;
    // the price run is what refreshes it.
    isbns.length > 0
      ? supabase
          .from('book_price_quotes')
          .select('isbn_13, quoted_cents, shipping_cents, vendor_name, vendor_url, fetched_at')
          .eq('source', 'buyback')
          .in('isbn_13', isbns)
      : none,
  ]);

  const byIsbn = new Map(
    (bookQuotes.data ?? []).map((r) => [r.isbn_13 as string, r as CachedQuote]),
  );
  const byBgg = new Map(
    (gameQuotes.data ?? []).map((r) => [r.bgg_id as number, r as CachedQuote]),
  );
  const byItem = new Map(
    (itemQuotes.data ?? []).map((r) => [r.inventory_item_id as string, r as CachedQuote]),
  );
  const buybackByIsbn = new Map(
    (buybackQuotes.data ?? []).map((r) => [r.isbn_13 as string, r]),
  );

  type Draft = {
    item: (typeof items)[number];
    lookedUpCents: number | null;
    lookedUp: CachedQuote | null;
    buyback: BuybackQuote | null;
  };

  const drafts: Draft[] = items.map((item) => {
    const target = targets.get(item.inventoryItemId)!;
    const lookedUp =
      target.via === 'isbn'
        ? (byIsbn.get(target.isbn13) ?? null)
        : target.via === 'bgg'
          ? (byBgg.get(target.bggId) ?? null)
          : (byItem.get(target.inventoryItemId) ?? null);

    let buyback: BuybackQuote | null = null;
    if (target.via === 'isbn') {
      const row = buybackByIsbn.get(target.isbn13);
      if (row && row.quoted_cents != null && quoteIsCurrent(row as CachedQuote, 'buyback')) {
        buyback = {
          vendor: (row.vendor_name as string | null) ?? 'Buyback',
          cents: row.quoted_cents as number,
          shippingCents: (row.shipping_cents as number | null) ?? 0,
          url: (row.vendor_url as string | null) ?? null,
        };
      }
    }

    return { item, lookedUp, lookedUpCents: lookedUp?.quoted_cents ?? null, buyback };
  });

  // The floor is derived from what is actually on the page, so a shelf of
  // paperbacks and a shelf of power tools each get a floor that means something.
  const netSelfSamples = drafts
    .map((d) => {
      const price = d.item.manualCents ?? d.lookedUpCents;
      return price != null
        ? netSelf({
            expectedPriceCents: price,
            shippingCents: shippingCentsForKind(d.item.kind),
            effortCents,
          }).netCents
        : null;
    })
    .filter((n): n is number => n != null);

  const netFloorCents =
    profile?.sell_net_floor_cents != null
      ? profile.sell_net_floor_cents
      : defaultNetFloorCents(netSelfSamples);

  const rows: SellQueueRow[] = drafts.map(({ item, lookedUp, lookedUpCents, buyback }) => {
    const expectedSelfListCents = item.manualCents ?? lookedUpCents;
    const decision =
      expectedSelfListCents != null || buyback != null
        ? routeSellDecision({
            expectedSelfListCents,
            buybackQuoteCents: buyback?.cents ?? null,
            buybackShippingCents: buyback?.shippingCents ?? 0,
            shippingCents: shippingCentsForKind(item.kind),
            effortCents,
            netFloorCents,
          })
        : null;

    return {
      inventoryItemId: item.inventoryItemId,
      name: item.name,
      shortName: item.shortName,
      imageUrl: item.imageUrl,
      kind: item.kind,
      subtitle: subtitleOf(item),
      costCents: item.costCents,
      needsConfirmation: item.needsConfirmation,
      expectedSelfListCents,
      priceIsManual: item.manualCents != null,
      priceIsStale:
        item.manualCents == null &&
        lookedUpCents != null &&
        priceSource !== 'none' &&
        !quoteIsCurrent(lookedUp, priceSource),
      path: decision?.path ?? null,
      reason: decision?.reason ?? null,
      netSelfCents: decision?.netSelfCents ?? null,
      netBuybackCents: decision?.netBuybackCents ?? null,
      buyback,
      donateFmvCents: donateFmvHintCents({
        expectedSelfListCents,
        buybackQuoteCents: buyback?.cents ?? null,
      }),
    };
  });

  return {
    rows,
    netFloorCents,
    effortCents,
    priceSource,
    unpricedCount: rows.filter((r) => r.expectedSelfListCents == null).length,
    needsConfirmationCount: rows.filter((r) => r.needsConfirmation).length,
  };
}
