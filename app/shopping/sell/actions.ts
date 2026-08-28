'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { attachBookDetailsForInventory } from '@/lib/books/attach-order-books';
import { createExpectedPriceSource } from '@/lib/sell/expected-price';
import { ESTIMATE_BATCH_LIMIT } from '@/lib/sell/load';
import { quoteIsCurrent, type CachedQuote } from '@/lib/sell/quote-cache';
import { mapPool } from '@/lib/async/map-pool';
import { parseDollarsToCents } from '@/lib/money';

export type SellActionState = {
  error?: string;
  message?: string;
};

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

  const { data: books } = await supabase
    .from('book_details')
    .select(
      'isbn_13, manual_expected_price_cents, inventory_items!inner (user_id, status)',
    )
    .eq('inventory_items.user_id', user.id)
    .eq('inventory_items.status', 'owned')
    .eq('needs_confirmation', false)
    .not('isbn_13', 'is', null);

  const isbns = [
    ...new Set(
      (books ?? [])
        .filter((b) => b.manual_expected_price_cents == null)
        .map((b) => b.isbn_13 as string),
    ),
  ];
  if (isbns.length === 0) return { message: 'Nothing to price.' };

  const { data: cachedRows } = await supabase
    .from('book_price_quotes')
    .select('isbn_13, quoted_cents, fetched_at')
    .eq('source', source)
    .in('isbn_13', isbns);

  // A row is only a price if it holds one and has not expired -- the same
  // question the loader asks. Counting every row as a price meant a lookup
  // that found nothing silenced this button permanently.
  const alreadyPriced = new Set(
    rescan
      ? []
      : (cachedRows ?? [])
          .filter((r) => quoteIsCurrent(r as CachedQuote, source))
          .map((r) => r.isbn_13 as string),
  );

  const outstanding = isbns.filter((isbn) => !alreadyPriced.has(isbn));
  const todo = outstanding.slice(0, ESTIMATE_BATCH_LIMIT);
  if (todo.length === 0) return { message: 'Every book already has a current price.' };

  let priced = 0;
  await mapPool(todo, 2, async (isbn13) => {
    try {
      const cents = await provider.expectedSelfListCents(isbn13);
      await supabase.from('book_price_quotes').upsert(
        {
          isbn_13: isbn13,
          source,
          quoted_cents: cents,
          shipping_cents: 0,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: 'isbn_13,source' },
      );
      if (cents != null) priced += 1;
    } catch (error) {
      console.error('price estimate failed', isbn13, error);
    }
  });

  revalidatePath('/shopping/sell');
  const remaining = outstanding.length - todo.length;
  const noneFound =
    priced === 0
      ? ' No price came back for any of them — the catalog had nothing to go on.'
      : '';
  return {
    message: `Priced ${priced} of ${todo.length} book(s).${
      remaining > 0 ? ` ${remaining} still unpriced — run again to continue.` : ''
    }${noneFound}`,
  };
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
