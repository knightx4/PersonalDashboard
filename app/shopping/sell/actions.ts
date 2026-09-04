'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import {
  createExpectedPriceSource,
  expectedPriceSourceKind,
} from '@/lib/sell/expected-price';
import { checkEbayConnection, type EbayCheckResult } from '@/lib/sell/ebay-check';
import { sellIdentityOf } from '@/lib/sell/item-quote';
import { runPriceLookups } from '@/lib/sell/price-run';
import { gamePriceQuery } from '@/lib/sell/game-query';
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


/**
 * Spend price lookups on what is marked for sale, on request only.
 *
 * Page loads never trigger a lookup: a web estimate costs real money per item,
 * so it happens when the user asks, and stops at ESTIMATE_BATCH_LIMIT so one
 * click cannot run away with a large library.
 *
 * Three buttons come through here. `ids` names specific items — one row's
 * "Price now", or everything ticked — and always fetches fresh, because being
 * told the cached price is fine does not answer the question that was asked.
 * With no ids it walks the whole for-sale list, filling in what has no price
 * unless `rescan` says to price it all again.
 */
export async function priceSellItems(
  _prev: SellActionState,
  formData: FormData,
): Promise<SellActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const raw = String(formData.get('ids') ?? '').trim();
  const ids = raw === '' ? undefined : raw.split(',').filter(Boolean);
  if (ids) {
    const parsed = z.array(z.string().uuid()).safeParse(ids);
    if (!parsed.success) return { error: 'Those items could not be read.' };
    if (parsed.data.length === 0) return { error: 'Nothing selected.' };
  }
  const rescan = String(formData.get('rescan') ?? '') === '1';

  const result = await runPriceLookups({
    supabase,
    userId: user.id,
    ids,
    // A named item is always re-fetched; a sweep of the whole list fills gaps.
    skipPriced: ids === undefined && !rescan,
  });

  if (result.source === 'none') {
    return { error: 'No price source configured.' };
  }

  revalidatePath('/shopping/sell');
  for (const id of ids ?? []) revalidatePath(`/shopping/inventory/${id}`);

  if (result.attempted === 0) {
    return {
      message:
        result.skipped > 0
          ? 'Everything already has a current price.'
          : 'Nothing to price.',
    };
  }

  const remaining =
    result.remaining > 0 ? ` ${result.remaining} left — run again to continue.` : '';
  const noneFound =
    result.priced === 0 ? ' No price came back — nothing comparable was listed.' : '';
  return {
    message: `Priced ${result.priced} of ${result.attempted} item(s).${remaining}${noneFound}`,
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

export type PriceSearchState = SellActionState & {
  /** What the source is asking, when it found anything. */
  foundCents?: number | null;
  /** What was searched for, so a wrong answer explains itself. */
  query?: string;
};

/**
 * Ask the price source what this item is going for, without committing to it.
 *
 * priceOneItem is the cached, identity-keyed path: it needs a confirmed ISBN or
 * BGG id, writes the quote to the shared cache, and refuses everything else.
 * This is the button next to it — a plain title search that answers for an item
 * whose edition is not settled, and hands the number back for the user to
 * accept rather than filing it against an identity nobody has confirmed.
 */
export async function searchItemPrice(
  _prev: PriceSearchState,
  formData: FormData,
): Promise<PriceSearchState> {
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

  const keys = {
    ebayClientId: process.env.EBAY_CLIENT_ID ?? null,
    ebayClientSecret: process.env.EBAY_CLIENT_SECRET ?? null,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
  };
  if (expectedPriceSourceKind(keys) === 'none') {
    return { error: 'No price source configured.' };
  }
  const provider = await createExpectedPriceSource(keys);

  const identity = await sellIdentityOf(supabase, item.id);
  const subject =
    identity?.kind === 'game'
      ? gamePriceQuery({
          name: item.name as string,
          yearPublished: identity.yearPublished,
          publisher: identity.publisher,
        })
      : {
          query: item.name as string,
          hint: 'Used copy in good condition, sold on eBay.',
        };

  let cents: number | null = null;
  try {
    // A confirmed ISBN is a far better query than the title, so use it when
    // there is one; everything else searches on what the item is called.
    cents =
      identity?.kind === 'book' && identity.isbn13 && !identity.needsConfirmation
        ? await provider.expectedSelfListCents(identity.isbn13)
        : await provider.expectedSelfListCentsFor(subject);
  } catch (error) {
    console.error('price search failed', item.id, error);
    return { error: 'The price search failed. Try again in a moment.' };
  }

  if (cents == null) {
    return {
      query: subject.query,
      foundCents: null,
      message: `Nothing comparable is listed for “${subject.query}”.`,
    };
  }
  return {
    query: subject.query,
    foundCents: cents,
    message: `${formatMoney(cents)} for “${subject.query}”.`,
  };
}

/**
 * Set (or clear) a sell price by hand. Free, and it beats every lookup.
 *
 * Which column it lands in follows the item: book_details for a book,
 * game_details for a game, and the item's own column for everything else. One
 * action rather than three, because the page it is used from no longer knows
 * or cares which of the three a row happens to be.
 */
export async function setSellPrice(
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

  const identity = await sellIdentityOf(supabase, item.id);
  const { error } =
    identity?.kind === 'book'
      ? await supabase
          .from('book_details')
          .update({ manual_expected_price_cents: cents })
          .eq('inventory_item_id', item.id)
      : identity?.kind === 'game'
        ? await supabase
            .from('game_details')
            .update({ manual_expected_price_cents: cents })
            .eq('inventory_item_id', item.id)
        : await supabase
            .from('inventory_items')
            .update({ manual_expected_price_cents: cents })
            .eq('id', item.id);
  if (error) return { error: error.message };

  revalidatePath('/shopping/sell');
  revalidatePath(`/shopping/inventory/${item.id}`);
  return { message: cents == null ? 'Price cleared.' : 'Price saved.' };
}
