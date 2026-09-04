/**
 * What one inventory item would sell for.
 *
 * The sell assistant answers this for the whole shelf at once; this answers it
 * for the single item whose page you are standing on. It reads the same caches
 * and runs the same router, so the two never disagree — the only differences
 * are deliberate:
 *
 *  - It never spends a lookup. Opening an item page must cost nothing, so an
 *    unpriced item stays unpriced until the "Price it" button is pressed.
 *  - The net floor is the user's own setting, or the default. The shelf derives
 *    a floor from the distribution of everything it loaded; loading the whole
 *    library to render one item would be a lot of work for one number.
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
  DEFAULT_NET_FLOOR_CENTS,
  shippingCentsForKind,
} from '@/lib/sell/pricing';
import { donateFmvHintCents, routeSellDecision, type SellPath } from '@/lib/sell/route';
import { quoteIsCurrent, type CachedQuote } from '@/lib/sell/quote-cache';
import { parsePriceEvidence, type PriceEvidence } from '@/lib/sell/price-evidence';
import { serverEnv } from '@/lib/env';

export type ItemSellQuote = {
  kind: SellItemKind;
  /**
   * Waiting on the user to confirm which edition this is. It no longer stops
   * the item being priced — an unconfirmed copy is priced by title and cached
   * against the item, exactly as the sell page does it — but it does say why
   * the number is about the title rather than the printing.
   */
  needsConfirmation: boolean;
  expectedSelfListCents: number | null;
  /** True when the number came from the user rather than a lookup. */
  priceIsManual: boolean;
  /** When the looked-up price was fetched, so a stale one can say so. */
  quotedAt: string | null;
  /**
   * What the lookup saw: the spread, and the listings behind the number.
   * Null for a manual price, and for a quote cached before evidence was kept.
   */
  evidence: PriceEvidence | null;
  quoteIsStale: boolean;
  path: SellPath | null;
  reason: string | null;
  netSelfCents: number | null;
  netBuybackCents: number | null;
  buyback: BuybackQuote | null;
  donateFmvCents: number;
  shippingCents: number;
  priceSource: ReturnType<typeof expectedPriceSourceKind>;
};

/** Same shape and same fallback as lib/sell/load.ts — see the note there. */
function envKeys() {
  try {
    const env = serverEnv();
    return {
      bookscouterApiKey: env.BOOKSCOUTER_API_KEY ?? null,
      ebayClientId: env.EBAY_CLIENT_ID ?? null,
      ebayClientSecret: env.EBAY_CLIENT_SECRET ?? null,
      anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
    };
  } catch {
    return {
      bookscouterApiKey: process.env.BOOKSCOUTER_API_KEY ?? null,
      ebayClientId: process.env.EBAY_CLIENT_ID ?? null,
      ebayClientSecret: process.env.EBAY_CLIENT_SECRET ?? null,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
    };
  }
}

/**
 * The item's book or game identity, or null when it is neither.
 *
 * Exported because the pricing action needs exactly the same answer, and the
 * two must not drift: a page that offers to price something the action then
 * refuses is worse than no button at all.
 */
export async function sellIdentityOf(
  supabase: SupabaseClient,
  inventoryItemId: string,
): Promise<
  | {
      kind: 'book';
      isbn13: string | null;
      needsConfirmation: boolean;
      manualCents: number | null;
    }
  | {
      kind: 'game';
      bggId: number | null;
      yearPublished: number | null;
      publisher: string | null;
      needsConfirmation: boolean;
      manualCents: number | null;
    }
  | null
> {
  const [{ data: book }, { data: game }] = await Promise.all([
    supabase
      .from('book_details')
      .select('isbn_13, needs_confirmation, manual_expected_price_cents')
      .eq('inventory_item_id', inventoryItemId)
      .maybeSingle(),
    supabase
      .from('game_details')
      .select('bgg_id, year_published, publisher, needs_confirmation, manual_expected_price_cents')
      .eq('inventory_item_id', inventoryItemId)
      .maybeSingle(),
  ]);

  if (book) {
    return {
      kind: 'book',
      isbn13: (book.isbn_13 as string | null) ?? null,
      needsConfirmation: Boolean(book.needs_confirmation),
      manualCents: (book.manual_expected_price_cents as number | null) ?? null,
    };
  }
  if (game) {
    return {
      kind: 'game',
      bggId: (game.bgg_id as number | null) ?? null,
      yearPublished: (game.year_published as number | null) ?? null,
      publisher: (game.publisher as string | null) ?? null,
      needsConfirmation: Boolean(game.needs_confirmation),
      manualCents: (game.manual_expected_price_cents as number | null) ?? null,
    };
  }
  return null;
}

export async function loadItemSellQuote(input: {
  supabase: SupabaseClient;
  userId: string;
  inventoryItemId: string;
}): Promise<ItemSellQuote | null> {
  const { supabase, userId, inventoryItemId } = input;

  // The same row the sell page loads, read through the same loader, so the
  // target below is the same target the sell page would have picked. Not
  // filtered on the for-sale flag: the panel answers "what is this worth" for
  // the item you are standing on, marked or not.
  const [item] = await loadForSaleItems({
    supabase,
    userId,
    ids: [inventoryItemId],
    includeNotForSale: true,
  });
  if (!item) return null;

  const keys = envKeys();
  const priceSource = expectedPriceSourceKind(keys);

  const { data: profile } = await supabase
    .from('profiles')
    .select('sell_net_floor_cents, sell_effort_cents')
    .eq('id', userId)
    .single();
  const effortCents = profile?.sell_effort_cents ?? DEFAULT_EFFORT_CENTS;
  const netFloorCents = profile?.sell_net_floor_cents ?? DEFAULT_NET_FLOOR_CENTS;

  const shippingCents = shippingCentsForKind(item.kind);

  // One decision about where this item's price lives, shared with the run that
  // writes it. Reading a different table from the one the sell page wrote is
  // how a priced item came to look unpriced here.
  const target = priceTargetOf(item);

  let cached: CachedQuote | null = null;
  let cachedEvidence: PriceEvidence | null = null;
  let buyback: BuybackQuote | null = null;

  if (priceSource !== 'none') {
    const { data } =
      target.via === 'isbn'
        ? await supabase
            .from('book_price_quotes')
            .select('quoted_cents, fetched_at, payload')
            .eq('isbn_13', target.isbn13)
            .eq('source', priceSource)
            .maybeSingle()
        : target.via === 'bgg'
          ? await supabase
              .from('game_price_quotes')
              .select('quoted_cents, fetched_at, payload')
              .eq('bgg_id', target.bggId)
              .eq('source', priceSource)
              .maybeSingle()
          : await supabase
              .from('item_price_quotes')
              .select('quoted_cents, fetched_at, payload')
              .eq('inventory_item_id', target.inventoryItemId)
              .eq('source', priceSource)
              .maybeSingle();
    cached = (data as CachedQuote | null) ?? null;
    // A payload written by an older deploy parses to null rather than throwing,
    // so the panel degrades to the bare number instead of failing to render.
    cachedEvidence = parsePriceEvidence((data as { payload?: unknown } | null)?.payload);
  }

  // Buyback is read from cache only — same rule as the price: no lookup on load.
  if (target.via === 'isbn') {
    const { data } = await supabase
      .from('book_price_quotes')
      .select('quoted_cents, shipping_cents, vendor_name, vendor_url, fetched_at')
      .eq('isbn_13', target.isbn13)
      .eq('source', 'buyback')
      .maybeSingle();
    if (data && data.quoted_cents != null && quoteIsCurrent(data, 'buyback')) {
      buyback = {
        vendor: (data.vendor_name as string | null) ?? 'Buyback',
        cents: data.quoted_cents as number,
        shippingCents: (data.shipping_cents as number | null) ?? 0,
        url: (data.vendor_url as string | null) ?? null,
      };
    }
  }

  const lookedUpCents = cached?.quoted_cents ?? null;
  const expectedSelfListCents = item.manualCents ?? lookedUpCents;

  const decision =
    expectedSelfListCents != null || buyback != null
      ? routeSellDecision({
          expectedSelfListCents,
          buybackQuoteCents: buyback?.cents ?? null,
          buybackShippingCents: buyback?.shippingCents ?? 0,
          shippingCents,
          effortCents,
          netFloorCents,
        })
      : null;

  return {
    kind: item.kind,
    needsConfirmation: item.needsConfirmation,
    expectedSelfListCents,
    priceIsManual: item.manualCents != null,
    quotedAt: item.manualCents == null ? (cached?.fetched_at ?? null) : null,
    // A price the user typed is the answer; showing comps beside it would
    // invite arguing with a decision already made.
    evidence: item.manualCents == null ? cachedEvidence : null,
    quoteIsStale:
      item.manualCents == null &&
      lookedUpCents != null &&
      priceSource !== 'none' &&
      !quoteIsCurrent(cached, priceSource),
    path: decision?.path ?? null,
    reason: decision?.reason ?? null,
    netSelfCents: decision?.netSelfCents ?? null,
    netBuybackCents: decision?.netBuybackCents ?? null,
    buyback,
    donateFmvCents: donateFmvHintCents({
      expectedSelfListCents,
      buybackQuoteCents: buyback?.cents ?? null,
    }),
    shippingCents,
    priceSource,
  };
}
