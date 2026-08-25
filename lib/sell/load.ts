/**
 * Load confirmed owned books and attach sell routing decisions.
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createBuybackProvider, type BuybackQuote } from '@/lib/sell/buyback';
import { createExpectedPriceSource } from '@/lib/sell/expected-price';
import {
  DEFAULT_EFFORT_CENTS,
  defaultNetFloorCents,
  netSelf,
} from '@/lib/sell/pricing';
import {
  donateFmvHintCents,
  routeSellDecision,
  type SellPath,
} from '@/lib/sell/route';
import { mapPool } from '@/lib/async/map-pool';
import { serverEnv } from '@/lib/env';

export type SellBookRow = {
  inventoryItemId: string;
  name: string;
  shortName: string | null;
  imageUrl: string | null;
  isbn13: string;
  authors: string[];
  condition: string | null;
  path: SellPath;
  reason: string;
  netSelfCents: number | null;
  netBuybackCents: number | null;
  expectedSelfListCents: number | null;
  buyback: BuybackQuote | null;
  donateFmvCents: number;
};

function envKeys() {
  try {
    const env = serverEnv();
    return {
      bookscouterApiKey: env.BOOKSCOUTER_API_KEY ?? null,
      ebayClientId: env.EBAY_CLIENT_ID ?? null,
      ebayClientSecret: env.EBAY_CLIENT_SECRET ?? null,
    };
  } catch {
    return {
      bookscouterApiKey: process.env.BOOKSCOUTER_API_KEY ?? null,
      ebayClientId: process.env.EBAY_CLIENT_ID ?? null,
      ebayClientSecret: process.env.EBAY_CLIENT_SECRET ?? null,
    };
  }
}

const QUOTE_TTL_MS = 1000 * 60 * 60 * 12; // 12h

async function cachedBuyback(
  supabase: SupabaseClient,
  isbn13: string,
  provider: ReturnType<typeof createBuybackProvider>,
): Promise<BuybackQuote | null> {
  const { data: cached } = await supabase
    .from('book_price_quotes')
    .select('quoted_cents, shipping_cents, vendor_name, vendor_url, fetched_at')
    .eq('isbn_13', isbn13)
    .eq('source', 'buyback')
    .maybeSingle();

  if (
    cached &&
    cached.fetched_at &&
    Date.now() - new Date(cached.fetched_at).getTime() < QUOTE_TTL_MS
  ) {
    if (cached.quoted_cents == null) return null;
    return {
      vendor: cached.vendor_name ?? 'Buyback',
      cents: cached.quoted_cents,
      shippingCents: cached.shipping_cents ?? 0,
      url: cached.vendor_url,
    };
  }

  const quote = await provider.quote(isbn13);
  await supabase.from('book_price_quotes').upsert(
    {
      isbn_13: isbn13,
      source: 'buyback',
      quoted_cents: quote?.cents ?? null,
      shipping_cents: quote?.shippingCents ?? 0,
      vendor_name: quote?.vendor ?? null,
      vendor_url: quote?.url ?? null,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'isbn_13,source' },
  );
  return quote;
}

async function cachedExpectedPrice(
  supabase: SupabaseClient,
  isbn13: string,
  provider: ReturnType<typeof createExpectedPriceSource>,
): Promise<number | null> {
  const { data: cached } = await supabase
    .from('book_price_quotes')
    .select('quoted_cents, fetched_at')
    .eq('isbn_13', isbn13)
    .eq('source', 'ebay_browse')
    .maybeSingle();

  if (
    cached &&
    cached.fetched_at &&
    Date.now() - new Date(cached.fetched_at).getTime() < QUOTE_TTL_MS
  ) {
    return cached.quoted_cents;
  }

  const cents = await provider.expectedSelfListCents(isbn13);
  await supabase.from('book_price_quotes').upsert(
    {
      isbn_13: isbn13,
      source: 'ebay_browse',
      quoted_cents: cents,
      shipping_cents: 0,
      fetched_at: new Date().toISOString(),
    },
    { onConflict: 'isbn_13,source' },
  );
  return cents;
}

export async function loadSellAssistant(input: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<{
  rows: SellBookRow[];
  netFloorCents: number;
  effortCents: number;
  needsConfirmationCount: number;
}> {
  const { supabase, userId } = input;
  const keys = envKeys();

  const { data: profile } = await supabase
    .from('profiles')
    .select('sell_net_floor_cents, sell_effort_cents')
    .eq('id', userId)
    .single();

  const effortCents = profile?.sell_effort_cents ?? DEFAULT_EFFORT_CENTS;

  const { data: books } = await supabase
    .from('book_details')
    .select(
      `
      isbn_13, authors, condition, needs_confirmation,
      inventory_items!inner (
        id, name, short_name, image_url, status, user_id
      )
    `,
    )
    .eq('inventory_items.user_id', userId)
    .eq('inventory_items.status', 'owned')
    .not('isbn_13', 'is', null);

  const all = books ?? [];
  const needsConfirmationCount = all.filter((b) => b.needs_confirmation).length;

  const confirmed = all.filter((b) => !b.needs_confirmation && b.isbn_13);

  const buybackProvider = createBuybackProvider({ apiKey: keys.bookscouterApiKey });
  const expectedProvider = createExpectedPriceSource({
    ebayClientId: keys.ebayClientId,
    ebayClientSecret: keys.ebayClientSecret,
  });

  type Draft = {
    inventoryItemId: string;
    name: string;
    shortName: string | null;
    imageUrl: string | null;
    isbn13: string;
    authors: string[];
    condition: string | null;
    expectedSelfListCents: number | null;
    buyback: BuybackQuote | null;
  };

  const drafts = await mapPool(confirmed, 3, async (row) => {
    const inv = Array.isArray(row.inventory_items)
      ? row.inventory_items[0]
      : row.inventory_items;
    if (!inv || !row.isbn_13) return null;
    const [buyback, expectedSelfListCents] = await Promise.all([
      cachedBuyback(supabase, row.isbn_13, buybackProvider),
      cachedExpectedPrice(supabase, row.isbn_13, expectedProvider),
    ]);
    return {
      inventoryItemId: inv.id as string,
      name: inv.name as string,
      shortName: (inv.short_name as string | null) ?? null,
      imageUrl: (inv.image_url as string | null) ?? null,
      isbn13: row.isbn_13 as string,
      authors: (row.authors as string[]) ?? [],
      condition: (row.condition as string | null) ?? null,
      expectedSelfListCents,
      buyback,
    } satisfies Draft;
  });

  const present = drafts.filter((d): d is Draft => d !== null);

  const netSelfSamples = present
    .map((d) =>
      d.expectedSelfListCents != null
        ? netSelf({
            expectedPriceCents: d.expectedSelfListCents,
            effortCents,
          }).netCents
        : null,
    )
    .filter((n): n is number => n != null);

  const netFloorCents =
    profile?.sell_net_floor_cents != null
      ? profile.sell_net_floor_cents
      : defaultNetFloorCents(netSelfSamples);

  const rows: SellBookRow[] = present.map((d) => {
    const decision = routeSellDecision({
      expectedSelfListCents: d.expectedSelfListCents,
      buybackQuoteCents: d.buyback?.cents ?? null,
      buybackShippingCents: d.buyback?.shippingCents ?? 0,
      effortCents,
      netFloorCents,
    });
    return {
      ...d,
      path: decision.path,
      reason: decision.reason,
      netSelfCents: decision.netSelfCents,
      netBuybackCents: decision.netBuybackCents,
      donateFmvCents: donateFmvHintCents({
        expectedSelfListCents: d.expectedSelfListCents,
        buybackQuoteCents: d.buyback?.cents ?? null,
      }),
    };
  });

  return { rows, netFloorCents, effortCents, needsConfirmationCount };
}
