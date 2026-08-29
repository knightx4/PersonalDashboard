/**
 * Owned board games, routed the same way books are.
 *
 * The sell assistant was written for books and looked only at book_details, so
 * a shelf of games rendered an empty page. The routing itself was never
 * book-specific -- netSelf() already takes a shipping figure and
 * routeSellDecision() already copes with no buyback quote -- so what was
 * actually missing was a loader and a price cache with a key games can use.
 *
 * Two things genuinely differ from books, and both are honest limitations
 * rather than temporary gaps:
 *
 *  - Shipping is a flat assumption (GAME_SHIP_FLAT_CENTS), not a published
 *    rate. Media Mail is media-only and cannot legally carry a board game.
 *  - There is no buyback path. Nothing buys board games back the way
 *    BookScouter buys textbooks, so a game routes between list, lot and donate.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  createExpectedPriceSource,
  expectedPriceSourceKind,
} from '@/lib/sell/expected-price';
import {
  DEFAULT_EFFORT_CENTS,
  GAME_SHIP_FLAT_CENTS,
  defaultNetFloorCents,
  netSelf,
} from '@/lib/sell/pricing';
import { donateFmvHintCents, routeSellDecision, type SellPath } from '@/lib/sell/route';
import { quoteIsCurrent } from '@/lib/sell/quote-cache';
import { gamePriceQuery } from '@/lib/sell/game-query';
import { mapPool } from '@/lib/async/map-pool';
import { serverEnv } from '@/lib/env';

export type SellGameRow = {
  inventoryItemId: string;
  name: string;
  shortName: string | null;
  imageUrl: string | null;
  bggId: number;
  yearPublished: number | null;
  publisher: string | null;
  condition: string | null;
  expectedSelfListCents: number | null;
  priceIsManual: boolean;
  path: SellPath;
  reason: string;
  netSelfCents: number | null;
  donateFmvCents: number;
};

export type SellGamePendingRow = {
  inventoryItemId: string;
  title: string;
  imageUrl: string | null;
  bggId: number | null;
  yearPublished: number | null;
  publisher: string | null;
  confirmationReason: string | null;
};

/** Same shape and same fallback as lib/sell/load.ts — see the note there. */
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

/** Read a cached price, and refresh it only when allowed to spend a lookup. */
async function cachedGamePrice(
  supabase: SupabaseClient,
  game: { bggId: number; name: string; yearPublished: number | null; publisher: string | null },
  provider: Awaited<ReturnType<typeof createExpectedPriceSource>>,
  sourceKind: 'ebay_browse' | 'web_estimate',
  allowFetch: boolean,
): Promise<number | null> {
  const { data: cached } = await supabase
    .from('game_price_quotes')
    .select('quoted_cents, fetched_at')
    .eq('bgg_id', game.bggId)
    .eq('source', sourceKind)
    .maybeSingle();

  if (cached && quoteIsCurrent(cached, sourceKind)) return cached.quoted_cents;
  if (!allowFetch) return cached?.quoted_cents ?? null;

  const subject = gamePriceQuery(game);
  const cents = await provider.expectedSelfListCentsFor(subject);
  await supabase.from('game_price_quotes').upsert(
    {
      bgg_id: game.bggId,
      source: sourceKind,
      quoted_cents: cents,
      shipping_cents: 0,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'bgg_id,source' },
  );
  return cents;
}

export async function loadSellGames(input: {
  supabase: SupabaseClient;
  userId: string;
  /** The floor derived from the book shelf, so both lists share one bar. */
  netFloorCents?: number;
  effortCents?: number;
}): Promise<{
  rows: SellGameRow[];
  pending: SellGamePendingRow[];
  needsConfirmationCount: number;
  unpricedCount: number;
}> {
  const { supabase, userId } = input;
  const keys = envKeys();

  const { data: games } = await supabase
    .from('game_details')
    .select(
      `
      bgg_id, year_published, publisher, condition, needs_confirmation,
      confirmation_reason, manual_expected_price_cents,
      inventory_items!inner ( id, name, short_name, image_url, status, user_id )
    `,
    )
    .eq('inventory_items.user_id', userId)
    .eq('inventory_items.status', 'owned');

  const all = games ?? [];
  const inventoryOf = (row: (typeof all)[number]) =>
    Array.isArray(row.inventory_items) ? row.inventory_items[0] : row.inventory_items;

  const pendingRows = all.filter((g) => g.needs_confirmation);
  const pending: SellGamePendingRow[] = pendingRows.flatMap((row) => {
    const inv = inventoryOf(row);
    if (!inv) return [];
    return [
      {
        inventoryItemId: inv.id as string,
        title: (inv.short_name as string | null) || (inv.name as string),
        imageUrl: (inv.image_url as string | null) ?? null,
        bggId: (row.bgg_id as number | null) ?? null,
        yearPublished: (row.year_published as number | null) ?? null,
        publisher: (row.publisher as string | null) ?? null,
        confirmationReason: (row.confirmation_reason as string | null) ?? null,
      },
    ];
  });

  const confirmed = all.filter((g) => !g.needs_confirmation && g.bgg_id != null);

  const priceSourceKind = expectedPriceSourceKind(keys);
  const provider = await createExpectedPriceSource({
    ebayClientId: keys.ebayClientId,
    ebayClientSecret: keys.ebayClientSecret,
    anthropicApiKey: keys.anthropicApiKey,
  });

  const effortCents = input.effortCents ?? DEFAULT_EFFORT_CENTS;

  type Draft = Omit<
    SellGameRow,
    'path' | 'reason' | 'netSelfCents' | 'donateFmvCents'
  >;

  const drafts = await mapPool(confirmed, 3, async (row) => {
    const inv = inventoryOf(row);
    if (!inv || row.bgg_id == null) return null;
    const manualCents = row.manual_expected_price_cents as number | null;
    const name = inv.name as string;
    const yearPublished = (row.year_published as number | null) ?? null;
    const publisher = (row.publisher as string | null) ?? null;

    const lookedUpCents =
      priceSourceKind === 'none'
        ? null
        : await cachedGamePrice(
            supabase,
            { bggId: row.bgg_id as number, name, yearPublished, publisher },
            provider,
            priceSourceKind,
            // Same rule as books: eBay costs nothing per call so it may refresh
            // on load, a web estimate is billed so it waits to be asked.
            priceSourceKind === 'ebay_browse',
          );

    return {
      inventoryItemId: inv.id as string,
      name,
      shortName: (inv.short_name as string | null) ?? null,
      imageUrl: (inv.image_url as string | null) ?? null,
      bggId: row.bgg_id as number,
      yearPublished,
      publisher,
      condition: (row.condition as string | null) ?? null,
      expectedSelfListCents: manualCents ?? lookedUpCents,
      priceIsManual: manualCents != null,
    } satisfies Draft;
  });

  const present = drafts.filter((d): d is Draft => d !== null);

  // Fall back to the games' own distribution when the caller has no floor --
  // a shelf that is all games would otherwise be measured against nothing.
  const netFloorCents =
    input.netFloorCents ??
    defaultNetFloorCents(
      present
        .map((d) =>
          d.expectedSelfListCents != null
            ? netSelf({
                expectedPriceCents: d.expectedSelfListCents,
                shippingCents: GAME_SHIP_FLAT_CENTS,
                effortCents,
              }).netCents
            : null,
        )
        .filter((n): n is number => n != null),
    );

  const rows: SellGameRow[] = present.map((d) => {
    const decision = routeSellDecision({
      expectedSelfListCents: d.expectedSelfListCents,
      // No vendor buys board games back, so there is never a quote to beat.
      buybackQuoteCents: null,
      shippingCents: GAME_SHIP_FLAT_CENTS,
      effortCents,
      netFloorCents,
    });
    return {
      ...d,
      path: decision.path,
      reason: decision.reason,
      netSelfCents: decision.netSelfCents,
      donateFmvCents: donateFmvHintCents({
        expectedSelfListCents: d.expectedSelfListCents,
        buybackQuoteCents: null,
      }),
    };
  });

  return {
    rows,
    pending,
    needsConfirmationCount: pendingRows.length,
    unpricedCount: rows.filter((r) => r.expectedSelfListCents == null).length,
  };
}
