'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { attachBookDetailsForInventory } from '@/lib/books/attach-order-books';
import {
  createExpectedPriceSource,
  expectedPriceSourceKind,
} from '@/lib/sell/expected-price';
import { checkEbayConnection, type EbayCheckResult } from '@/lib/sell/ebay-check';
import { sellIdentityOf } from '@/lib/sell/item-quote';
import { ESTIMATE_BATCH_LIMIT } from '@/lib/sell/load';
import { gamePriceQuery } from '@/lib/sell/game-query';
import { quoteIsCurrent, type CachedQuote } from '@/lib/sell/quote-cache';
import { mapPool } from '@/lib/async/map-pool';
import { formatMoney, parseDollarsToCents } from '@/lib/money';

export type SellActionState = {
  error?: string;
  message?: string;
};

export type EbayCheckState = {
  result?: EbayCheckResult;
};

/**
 * Run one live eBay lookup and hand back the verdict.
 *
 * Reads the credentials on the server and returns only the verdict, so the
 * page can say what is wrong without either key going near the browser.
 */
export async function testEbayConnection(): Promise<EbayCheckState> {
  // Gated on a signed-in user: the result names the failing stage, which is
  // more than an anonymous visitor should learn about the deployment.
  await requireUser();
  const result = await checkEbayConnection({
    clientId: process.env.EBAY_CLIENT_ID ?? null,
    clientSecret: process.env.EBAY_CLIENT_SECRET ?? null,
  });
  return { result };
}

export async function updateSellSettings(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  let floorCents: number | null = null;
  const floorRaw = String(formData.get('net_floor') ?? '').trim();
  if (floorRaw !== '') {
    try {
      floorCents = parseDollarsToCents(floorRaw);
    } catch {
      return { error: 'Net floor must be a dollar amount like 10.00.' };
    }
  }

  let effortCents = 500;
  const effortRaw = String(formData.get('effort') ?? '').trim();
  if (effortRaw !== '') {
    try {
      effortCents = parseDollarsToCents(effortRaw);
    } catch {
      return { error: 'Effort cost must be a dollar amount like 5.00.' };
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      sell_net_floor_cents: floorCents,
      sell_effort_cents: effortCents,
    })
    .eq('id', user.id);
  if (error) return { error: error.message };

  revalidatePath('/shopping/sell');
  return { message: 'Sell settings saved.' };
}

export async function noteListingIntent(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return { error: 'Missing item.' };

  const note = String(formData.get('note') ?? '').trim() || 'Planning to list myself.';

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id, notes')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) return { error: 'Item not found.' };

  const nextNotes = item.notes ? `${item.notes}\n${note}` : note;
  const { error } = await supabase
    .from('inventory_items')
    .update({ notes: nextNotes })
    .eq('id', item.id);
  if (error) return { error: error.message };

  revalidatePath('/shopping/sell');
  revalidatePath(`/shopping/inventory/${item.id}`);
  return { message: 'Noted — draft only; nothing was posted.' };
}


/** How many owned units one scan looks at; book lookups are third-party HTTP. */
const SCAN_LIMIT = 150;

/**
 * Find books among inventory the user already has — orders imported before
 * book detection existed, or manual entries — and give them ISBN identity.
 * New email imports do this automatically during ingestion.
 */
export async function importBooksFromOrders(
  // Signature is fixed by useActionState; the scan takes no input of its own.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prev: SellActionState, _formData: FormData,
): Promise<SellActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: items, error } = await supabase
    .from('inventory_items')
    .select(
      `
      id, name, variant, image_url, search_tags,
      categories ( slug ),
      order_items ( product_url )
    `,
    )
    .eq('user_id', user.id)
    .eq('status', 'owned')
    .order('created_at', { ascending: false })
    .limit(SCAN_LIMIT);
  if (error) return { error: error.message };
  if (!items || items.length === 0) return { message: 'No owned items to scan yet.' };

  const first = <T,>(value: T | T[] | null | undefined): T | null => {
    if (Array.isArray(value)) return value[0] ?? null;
    return value ?? null;
  };

  const result = await attachBookDetailsForInventory(supabase, {
    userId: user.id,
    autoImported: true,
    googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY ?? null,
    isbndbApiKey: process.env.ISBNDB_API_KEY ?? null,
    lines: items.map((item) => ({
      inventoryItemId: item.id as string,
      name: item.name as string,
      variant: (item.variant as string | null) ?? null,
      imageUrl: (item.image_url as string | null) ?? null,
      searchTags: (item.search_tags as string[] | null) ?? [],
      categorySlug: first(item.categories as { slug: string } | { slug: string }[] | null)?.slug ?? null,
      productUrl:
        first(item.order_items as { product_url: string | null } | { product_url: string | null }[] | null)
          ?.product_url ?? null,
    })),
  });

  revalidatePath('/shopping/sell');
  revalidatePath('/shopping/inventory');

  if (result.attached === 0) {
    return {
      message:
        result.unresolved > 0
          ? `No new books added — ${result.unresolved} book-looking item(s) had no catalog match.`
          : 'No new books found in your recent items.',
    };
  }
  return {
    message: `Added book details for ${result.attached} item(s)${
      result.unresolved > 0 ? `; ${result.unresolved} had no catalog match` : ''
    }.`,
  };
}


/**
 * Spend a capped number of billed price lookups, on request only.
 *
 * Page loads never trigger these: a web estimate costs real money per book,
 * so it happens when the user asks and stops at ESTIMATE_BATCH_LIMIT so one
 * click cannot run away with a large library.
 */
export async function estimateMissingPrices(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  // "Rescan" ignores the cache and prices the books again from scratch. The
  // batch limit still applies, so the click costs the same as any other.
  const rescan = String(formData.get('rescan') ?? '') === '1';

  const provider = await createExpectedPriceSource({
    ebayClientId: process.env.EBAY_CLIENT_ID ?? null,
    ebayClientSecret: process.env.EBAY_CLIENT_SECRET ?? null,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
  });

  const usingWebEstimate = !(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);
  const source = usingWebEstimate ? 'web_estimate' : 'ebay_browse';
  if (usingWebEstimate && !process.env.ANTHROPIC_API_KEY) {
    return { error: 'No price source configured.' };
  }

  // Books and games share the batch. One click, one budget -- otherwise the
  // shelf with 35 games and 4 books would need the games priced fifteen at a
  // time behind a button that says "book".
  const [{ data: books }, { data: games }] = await Promise.all([
    supabase
      .from('book_details')
      .select('isbn_13, manual_expected_price_cents, inventory_items!inner (user_id, status)')
      .eq('inventory_items.user_id', user.id)
      .eq('inventory_items.status', 'owned')
      .eq('needs_confirmation', false)
      .not('isbn_13', 'is', null),
    supabase
      .from('game_details')
      .select(
        'bgg_id, year_published, publisher, manual_expected_price_cents, inventory_items!inner (name, user_id, status)',
      )
      .eq('inventory_items.user_id', user.id)
      .eq('inventory_items.status', 'owned')
      .eq('needs_confirmation', false)
      .not('bgg_id', 'is', null),
  ]);

  const isbns = [
    ...new Set(
      (books ?? [])
        .filter((b) => b.manual_expected_price_cents == null)
        .map((b) => b.isbn_13 as string),
    ),
  ];

  const firstInventory = (value: unknown): { name?: string } | null => {
    if (Array.isArray(value)) return (value[0] as { name?: string }) ?? null;
    return (value as { name?: string } | null) ?? null;
  };

  const gameTargets = new Map<number, { bggId: number; query: string; hint: string }>();
  for (const row of games ?? []) {
    if (row.manual_expected_price_cents != null) continue;
    const bggId = row.bgg_id as number | null;
    const name = firstInventory(row.inventory_items)?.name;
    if (bggId == null || !name) continue;
    const subject = gamePriceQuery({
      name,
      yearPublished: (row.year_published as number | null) ?? null,
      publisher: (row.publisher as string | null) ?? null,
    });
    gameTargets.set(bggId, { bggId, ...subject });
  }

  if (isbns.length === 0 && gameTargets.size === 0) {
    return { message: 'Nothing to price.' };
  }

  const [{ data: cachedBooks }, { data: cachedGames }] = await Promise.all([
    isbns.length > 0
      ? supabase
          .from('book_price_quotes')
          .select('isbn_13, quoted_cents, fetched_at')
          .eq('source', source)
          .in('isbn_13', isbns)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    gameTargets.size > 0
      ? supabase
          .from('game_price_quotes')
          .select('bgg_id, quoted_cents, fetched_at')
          .eq('source', source)
          .in('bgg_id', [...gameTargets.keys()])
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ]);

  // A row is only a price if it holds one and has not expired -- the same
  // question the loader asks. Counting every row as a price meant a lookup
  // that found nothing silenced this button permanently.
  const pricedIsbns = new Set(
    rescan
      ? []
      : (cachedBooks ?? [])
          .filter((r) => quoteIsCurrent(r as CachedQuote, source))
          .map((r) => r.isbn_13 as string),
  );
  const pricedGames = new Set(
    rescan
      ? []
      : (cachedGames ?? [])
          .filter((r) => quoteIsCurrent(r as CachedQuote, source))
          .map((r) => r.bgg_id as number),
  );

  type Target =
    | { kind: 'book'; isbn13: string }
    | { kind: 'game'; bggId: number; query: string; hint: string };

  const outstanding: Target[] = [
    ...isbns
      .filter((isbn) => !pricedIsbns.has(isbn))
      .map((isbn13) => ({ kind: 'book' as const, isbn13 })),
    ...[...gameTargets.values()]
      .filter((game) => !pricedGames.has(game.bggId))
      .map((game) => ({ kind: 'game' as const, ...game })),
  ];

  const todo = outstanding.slice(0, ESTIMATE_BATCH_LIMIT);
  if (todo.length === 0) return { message: 'Everything already has a current price.' };

  let priced = 0;
  await mapPool(todo, 2, async (target) => {
    try {
      const cents =
        target.kind === 'book'
          ? await provider.expectedSelfListCents(target.isbn13)
          : await provider.expectedSelfListCentsFor({
              query: target.query,
              hint: target.hint,
            });

      if (target.kind === 'book') {
        await supabase.from('book_price_quotes').upsert(
          {
            isbn_13: target.isbn13,
            source,
            quoted_cents: cents,
            shipping_cents: 0,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: 'isbn_13,source' },
        );
      } else {
        await supabase.from('game_price_quotes').upsert(
          {
            bgg_id: target.bggId,
            source,
            quoted_cents: cents,
            shipping_cents: 0,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: 'bgg_id,source' },
        );
      }
      if (cents != null) priced += 1;
    } catch (error) {
      console.error('price estimate failed', target, error);
    }
  });

  revalidatePath('/shopping/sell');
  const remaining = outstanding.length - todo.length;
  const noneFound =
    priced === 0
      ? ' No price came back for any of them — the catalog had nothing to go on.'
      : '';
  return {
    message: `Priced ${priced} of ${todo.length} item(s).${
      remaining > 0 ? ` ${remaining} still unpriced — run again to continue.` : ''
    }${noneFound}`,
  };
}

/**
 * Price one item, now, because someone asked for that item.
 *
 * The batch above walks the whole shelf and skips anything already priced;
 * this is the button on a single item's page, so it always spends the lookup —
 * asking for a price and being told the cached one is still fresh is not an
 * answer to the question that was asked.
 */
export async function priceOneItem(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('inventory_item_id'));
  if (!id.success) return { error: 'Missing item.' };

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id, name')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) return { error: 'Item not found.' };

  const identity = await sellIdentityOf(supabase, item.id);
  if (!identity) {
    return { error: 'Pricing needs a matched book or board game.' };
  }
  if (identity.needsConfirmation) {
    return { error: 'Confirm which edition this is first, then price it.' };
  }

  const keys = {
    ebayClientId: process.env.EBAY_CLIENT_ID ?? null,
    ebayClientSecret: process.env.EBAY_CLIENT_SECRET ?? null,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
  };
  const source = expectedPriceSourceKind(keys);
  if (source === 'none') return { error: 'No price source configured.' };
  const provider = await createExpectedPriceSource(keys);

  let cents: number | null = null;
  try {
    if (identity.kind === 'book') {
      if (!identity.isbn13) return { error: 'This book has no ISBN to look up.' };
      cents = await provider.expectedSelfListCents(identity.isbn13);
      await supabase.from('book_price_quotes').upsert(
        {
          isbn_13: identity.isbn13,
          source,
          quoted_cents: cents,
          shipping_cents: 0,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'isbn_13,source' },
      );
    } else {
      if (identity.bggId == null) return { error: 'This game has no BGG match to look up.' };
      cents = await provider.expectedSelfListCentsFor(
        gamePriceQuery({
          name: item.name as string,
          yearPublished: identity.yearPublished,
          publisher: identity.publisher,
        }),
      );
      await supabase.from('game_price_quotes').upsert(
        {
          bgg_id: identity.bggId,
          source,
          quoted_cents: cents,
          shipping_cents: 0,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'bgg_id,source' },
      );
    }
  } catch (error) {
    console.error('price lookup failed', item.id, error);
    return { error: 'The price lookup failed. Try again in a moment.' };
  }

  revalidatePath('/shopping/sell');
  revalidatePath(`/shopping/inventory/${item.id}`);

  if (cents == null) {
    return {
      message:
        identity.manualCents != null
          ? 'No price came back — your own price still stands.'
          : 'No price came back — nothing comparable was listed.',
    };
  }
  return { message: `Priced at ${formatMoney(cents)}.` };
}

/** Set (or clear) a price by hand. Free, and it beats every lookup. */
export async function setManualPrice(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('inventory_item_id'));
  if (!id.success) return { error: 'Missing item.' };

  const raw = String(formData.get('price') ?? '').trim();
  let cents: number | null = null;
  if (raw !== '') {
    try {
      cents = parseDollarsToCents(raw);
    } catch {
      return { error: 'Price must be a dollar amount like 12.50.' };
    }
  }

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) return { error: 'Item not found.' };

  const { error } = await supabase
    .from('book_details')
    .update({ manual_expected_price_cents: cents })
    .eq('inventory_item_id', item.id);
  if (error) return { error: error.message };

  revalidatePath('/shopping/sell');
  revalidatePath(`/shopping/inventory/${item.id}`);
  return { message: cents == null ? 'Price cleared.' : 'Price saved.' };
}

/**
 * The same by-hand price for a game.
 *
 * Separate from setManualPrice because the column lives on game_details, and
 * it earns its keep more here than for books: a title search is a far weaker
 * identifier than an ISBN, so lookups come back empty more often and typing
 * the number yourself is frequently the only way a game gets priced at all.
 */
export async function setManualGamePrice(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const id = z.string().uuid().safeParse(formData.get('inventory_item_id'));
  if (!id.success) return { error: 'Missing item.' };

  const raw = String(formData.get('price') ?? '').trim();
  let cents: number | null = null;
  if (raw !== '') {
    try {
      cents = parseDollarsToCents(raw);
    } catch {
      return { error: 'Price must be a dollar amount like 12.50.' };
    }
  }

  const { data: item } = await supabase
    .from('inventory_items')
    .select('id')
    .eq('id', id.data)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!item) return { error: 'Item not found.' };

  const { error } = await supabase
    .from('game_details')
    .update({ manual_expected_price_cents: cents })
    .eq('inventory_item_id', item.id);
  if (error) return { error: error.message };

  revalidatePath('/shopping/sell');
  revalidatePath(`/shopping/inventory/${item.id}`);
  return { message: cents == null ? 'Price cleared.' : 'Price saved.' };
}
