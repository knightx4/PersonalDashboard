/**
 * Spend price lookups on the things you marked for sale.
 *
 * One engine behind three buttons, because they differ only in which items they
 * hand it and whether a current price counts as an answer:
 *
 *   Price everything unpriced   every for-sale item, skipping what is priced
 *   Rescan                      every for-sale item, ignoring the cache
 *   Price now / Price selected  named items, ignoring the cache — asking for a
 *                               price and being told the cached one is fine is
 *                               not an answer to the question that was asked
 *
 * Every run is capped at ESTIMATE_BATCH_LIMIT, because the web-estimate source
 * is billed per lookup and one click must not be able to run away with a large
 * library. What is left over is reported, not silently dropped.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { mapPool } from '@/lib/async/map-pool';
import { lookupPriceByIsbn, lookupPriceBySubject } from '@/lib/sell/price-lookup';
import { createBuybackProvider } from '@/lib/sell/buyback';
import {
  createExpectedPriceSource,
  expectedPriceSourceKind,
} from '@/lib/sell/expected-price';
import { loadForSaleItems, priceTargetOf, type PriceTarget } from '@/lib/sell/for-sale';
import { quoteIsCurrent, type CachedQuote } from '@/lib/sell/quote-cache';

/** How many lookups one click may spend. */
export const ESTIMATE_BATCH_LIMIT = 15;

export type PriceRunResult = {
  source: ReturnType<typeof expectedPriceSourceKind>;
  /** Items the run actually looked up. */
  attempted: number;
  /** Of those, the ones a number came back for. */
  priced: number;
  /** Wanted pricing but did not fit in this batch. */
  remaining: number;
  /** Already had a current price, on a run that skips those. */
  skipped: number;
};

function envKeys() {
  return {
    ebayClientId: process.env.EBAY_CLIENT_ID ?? null,
    ebayClientSecret: process.env.EBAY_CLIENT_SECRET ?? null,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
  };
}

/** Which of the three caches already holds a current price for each target. */
async function currentlyPriced(
  supabase: SupabaseClient,
  targets: PriceTarget[],
  source: 'ebay_browse' | 'web_estimate',
): Promise<{ isbns: Set<string>; bggIds: Set<number>; itemIds: Set<string> }> {
  const isbns = [...new Set(targets.flatMap((t) => (t.via === 'isbn' ? [t.isbn13] : [])))];
  const bggIds = [...new Set(targets.flatMap((t) => (t.via === 'bgg' ? [t.bggId] : [])))];
  const itemIds = targets.flatMap((t) => (t.via === 'item' ? [t.inventoryItemId] : []));

  const none = { data: [] as Record<string, unknown>[] };
  const [books, games, items] = await Promise.all([
    isbns.length > 0
      ? supabase
          .from('book_price_quotes')
          .select('isbn_13, quoted_cents, fetched_at')
          .eq('source', source)
          .in('isbn_13', isbns)
      : none,
    bggIds.length > 0
      ? supabase
          .from('game_price_quotes')
          .select('bgg_id, quoted_cents, fetched_at')
          .eq('source', source)
          .in('bgg_id', bggIds)
      : none,
    itemIds.length > 0
      ? supabase
          .from('item_price_quotes')
          .select('inventory_item_id, quoted_cents, fetched_at')
          .eq('source', source)
          .in('inventory_item_id', itemIds)
      : none,
  ]);

  const current = (rows: Record<string, unknown>[] | null) =>
    (rows ?? []).filter((r) => quoteIsCurrent(r as CachedQuote, source));

  return {
    isbns: new Set(current(books.data).map((r) => r.isbn_13 as string)),
    bggIds: new Set(current(games.data).map((r) => r.bgg_id as number)),
    itemIds: new Set(current(items.data).map((r) => r.inventory_item_id as string)),
  };
}

/**
 * Look one target up and write the answer to the cache it belongs to.
 *
 * The batch below calls this once per item; the button on a single item's page
 * calls it once. Same query, same table, same row — which is the whole point:
 * a price found from either page has to be the price the other one reads.
 */
export async function priceOneTarget(input: {
  supabase: SupabaseClient;
  target: PriceTarget;
  source: 'ebay_browse' | 'web_estimate';
  provider: Awaited<ReturnType<typeof createExpectedPriceSource>>;
  buybackProvider?: ReturnType<typeof createBuybackProvider> | null;
}): Promise<number | null> {
  const { supabase, target, source, provider, buybackProvider } = input;
  const fetchedAt = new Date().toISOString();

  try {
    const { cents, evidence } =
      target.via === 'isbn'
        ? await lookupPriceByIsbn(provider, target.isbn13)
        : await lookupPriceBySubject(provider, { query: target.query, hint: target.hint });

    // A null is written too: it is what stops the next run asking again
    // immediately, and quoteIsCurrent already refuses to treat it as a price.
    if (target.via === 'isbn') {
      await supabase.from('book_price_quotes').upsert(
        {
          isbn_13: target.isbn13,
          source,
          quoted_cents: cents,
          shipping_cents: 0,
          payload: evidence,
          fetched_at: fetchedAt,
        },
        { onConflict: 'isbn_13,source' },
      );
    } else if (target.via === 'bgg') {
      await supabase.from('game_price_quotes').upsert(
        {
          bgg_id: target.bggId,
          source,
          quoted_cents: cents,
          shipping_cents: 0,
          payload: evidence,
          fetched_at: fetchedAt,
        },
        { onConflict: 'bgg_id,source' },
      );
    } else {
      await supabase.from('item_price_quotes').upsert(
        {
          inventory_item_id: target.inventoryItemId,
          source,
          quoted_cents: cents,
          shipping_cents: 0,
          payload: evidence,
          fetched_at: fetchedAt,
        },
        { onConflict: 'inventory_item_id,source' },
      );
    }
    return cents;
  } finally {
    // Buyback rides along with the ISBN it belongs to: it is the only path that
    // can beat self-listing, and it would otherwise never be refreshed at all.
    // In `finally` because it is a different provider — an expected-price
    // outage is no reason to leave the buyback quote stale too.
    if (buybackProvider && target.via === 'isbn') {
      try {
        const quote = await buybackProvider.quote(target.isbn13);
        await supabase.from('book_price_quotes').upsert(
          {
            isbn_13: target.isbn13,
            source: 'buyback',
            quoted_cents: quote?.cents ?? null,
            shipping_cents: quote?.shippingCents ?? 0,
            vendor_name: quote?.vendor ?? null,
            vendor_url: quote?.url ?? null,
            fetched_at: fetchedAt,
          },
          { onConflict: 'isbn_13,source' },
        );
      } catch (error) {
        console.error('buyback lookup failed', target.isbn13, error);
      }
    }
  }
}

export async function runPriceLookups(input: {
  supabase: SupabaseClient;
  userId: string;
  /** Specific items; every for-sale item when omitted. */
  ids?: string[];
  /** True for the "fill in the gaps" run, false when fresh prices were asked for. */
  skipPriced: boolean;
}): Promise<PriceRunResult> {
  const { supabase, userId, ids, skipPriced } = input;

  const keys = envKeys();
  const source = expectedPriceSourceKind(keys);
  const empty: PriceRunResult = { source, attempted: 0, priced: 0, remaining: 0, skipped: 0 };
  if (source === 'none') return empty;

  const items = await loadForSaleItems({ supabase, userId, ids });
  if (items.length === 0) return empty;

  const withTargets = items.map((item) => ({ item, target: priceTargetOf(item) }));

  let candidates = withTargets;
  let skipped = 0;
  if (skipPriced) {
    const priced = await currentlyPriced(
      supabase,
      withTargets.map((t) => t.target),
      source,
    );
    candidates = withTargets.filter(({ item, target }) => {
      // A price typed by hand is the answer already, and beats every lookup.
      if (item.manualCents != null) return false;
      if (target.via === 'isbn') return !priced.isbns.has(target.isbn13);
      if (target.via === 'bgg') return !priced.bggIds.has(target.bggId);
      return !priced.itemIds.has(target.inventoryItemId);
    });
    skipped = withTargets.length - candidates.length;
  }

  const todo = candidates.slice(0, ESTIMATE_BATCH_LIMIT);
  if (todo.length === 0) return { ...empty, skipped };

  const provider = await createExpectedPriceSource(keys);
  const buybackProvider = process.env.BOOKSCOUTER_API_KEY
    ? createBuybackProvider({ apiKey: process.env.BOOKSCOUTER_API_KEY })
    : null;

  let priced = 0;
  await mapPool(todo, 2, async ({ target }) => {
    try {
      const cents = await priceOneTarget({
        supabase,
        target,
        source,
        provider,
        buybackProvider,
      });
      if (cents != null) priced += 1;
    } catch (error) {
      console.error('price lookup failed', target, error);
    }
  });

  return {
    source,
    attempted: todo.length,
    priced,
    remaining: candidates.length - todo.length,
    skipped,
  };
}
