/**
 * The Shopping writers capture makes rows with (plan #1950.3.1): an order
 * from a sentence, something owned from its name or ISBN, and a saved thing
 * from its link. Bound to the signed-in person's client in
 * app/capture-actions.ts; lib/capture/file.ts records each and says where it
 * went.
 *
 * Each one makes its row in one press and leaves the details to the row's own
 * page, so nothing here asks a second question: a sentence the model cannot
 * read is still an order of one line, and a link whose page cannot be read is
 * still saved under its address.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { createClient, requireUser } from '@/lib/auth/server';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { serverEnv } from '@/lib/env';
import { fingerprintLoose } from '@/lib/fingerprint';
import { todayInTimezone } from '@/lib/money';
import { buildManualOrder } from '@/lib/orders/create-manual-order';
import { orderDraftTitle, orderFromSentenceAlone, type OrderDraft } from '@/lib/orders/from-sentence';
import { readOrderSentence } from '@/lib/orders/sentence-model';
import { findMerchantByUrl } from '@/lib/saved/resolve-merchant';
import { scrapeProductUrl } from '@/lib/saved/scrape-product';
import { ensureItemTags, linkOrderItemTags } from '@/lib/tags/ensure';
import { linkIn, linkTitle, typedIsbn } from '@/lib/capture/shopping-text';
import type { ShoppingMade } from '@/lib/capture/file';
import type { ScannedThing } from '@/lib/capture/actions';
import { classifyScannedCode } from '@/lib/barcodes/scan-code';
import { saveOwnedBook, searchOwnedBook } from './inventory/add/actions';
import { saveGame, searchGame } from './inventory/add/games/actions';
import { saveManualItem } from './inventory/add/item-actions';
import { readReceiptPhoto, saveReceiptOrder } from './orders/receipt-order';

type Client = Awaited<ReturnType<typeof createClient>>;

function apiKey(): string | null {
  try {
    return serverEnv().ANTHROPIC_API_KEY ?? null;
  } catch {
    return process.env.ANTHROPIC_API_KEY ?? null;
  }
}

async function today(supabase: Client, userId: string): Promise<string> {
  const { data } = await supabase.from('profiles').select('timezone').eq('id', userId).single();
  return todayInTimezone(data?.timezone ?? 'UTC');
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** The person's merchant of that name, made when they have none, as the order form makes one. */
async function merchantFor(
  supabase: Client,
  userId: string,
  name: string | null,
): Promise<{ id: string; slug: string } | null> {
  if (!name) return null;
  const { data: known } = await supabase.from('merchants').select('id, slug').ilike('name', name).limit(1);
  if (known && known.length > 0) return known[0] as { id: string; slug: string };
  const { data: created } = await supabase
    .from('merchants')
    .insert({
      name,
      slug: `${slugify(name) || 'merchant'}-${userId.slice(0, 8)}`,
      created_by_user_id: userId,
      is_global: false,
    })
    .select('id, slug')
    .single();
  return (created as { id: string; slug: string } | null) ?? null;
}

/**
 * Write an order and what it made: its lines and one inventory item per
 * unit, as the order form writes them. A failure part way takes the order
 * back out, so no half-made order is left.
 */
async function saveOrder(supabase: Client, userId: string, draft: OrderDraft): Promise<ShoppingMade> {
  const merchant = await merchantFor(supabase, userId, draft.merchantName);
  const slugs = [...new Set(draft.lines.map((line) => line.categorySlug).filter(Boolean))] as string[];
  const bySlug = new Map<string, { id: string; slug: string; name: string }>();
  if (slugs.length > 0) {
    const { data } = await supabase.from('categories').select('id, slug, name').is('parent_id', null).in('slug', slugs);
    for (const row of (data ?? []) as { id: string; slug: string; name: string }[]) bySlug.set(row.slug, row);
  }

  const built = buildManualOrder({
    userId,
    merchantId: merchant?.id ?? null,
    merchantSlug: merchant?.slug ?? null,
    orderDate: draft.orderDate,
    taxCents: 0,
    shippingCents: 0,
    discountCents: 0,
    source: 'manual',
    lines: draft.lines.map((line) => {
      const category = line.categorySlug ? bySlug.get(line.categorySlug) : undefined;
      return {
        name: line.name,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        categoryId: category?.id ?? null,
        categorySlug: category?.slug ?? null,
        categoryName: category?.name ?? null,
      };
    }),
  });

  const { error: orderError } = await supabase.from('orders').insert({
    id: built.order.id,
    user_id: userId,
    merchant_id: built.order.merchantId,
    source: built.order.source,
    external_order_number: null,
    order_date: built.order.orderDate,
    subtotal_cents: built.order.subtotalCents,
    tax_cents: 0,
    shipping_cents: 0,
    discount_cents: 0,
    total_cents: built.order.totalCents,
    currency: built.order.currency,
  });
  if (orderError) {
    console.error('capture: the order could not be written', orderError.message);
    return { ok: false, error: 'The order could not be added. Try again.' };
  }

  const undo = async () => {
    await supabase.from('orders').delete().eq('id', built.order.id);
    return { ok: false as const, error: 'The order could not be added. Try again.' };
  };

  const { error: itemsError } = await supabase.from('order_items').insert(
    built.orderItems.map((item) => ({
      id: item.id,
      order_id: item.orderId,
      category_id: item.categoryId,
      name: item.name,
      short_name: item.shortName,
      variant: item.variant,
      quantity: item.quantity,
      unit_price_cents: item.unitPriceCents,
      fingerprint_strict: item.fingerprintStrict,
      fingerprint_loose: item.fingerprintLoose,
    })),
  );
  if (itemsError) return undo();

  for (const item of built.orderItems) {
    if (item.tags.length === 0) continue;
    try {
      const tags = await ensureItemTags(supabase, userId, item.tags);
      await linkOrderItemTags(supabase, item.id, tags.map((tag) => tag.id));
    } catch {
      // Tags are a help to search; the order stands without them.
    }
  }

  const { error: inventoryError } = await supabase.from('inventory_items').insert(
    built.inventoryItems.map((item) => ({
      id: item.id,
      user_id: item.userId,
      order_item_id: item.orderItemId,
      category_id: item.categoryId,
      name: item.name,
      short_name: item.shortName,
      variant: item.variant,
      fingerprint_loose: item.fingerprintLoose,
      acquired_at: item.acquiredAt,
      cost_cents: item.costCents,
      search_tags: item.searchTags,
      source: item.source,
    })),
  );
  if (inventoryError) return undo();

  return { ok: true, id: built.order.id, title: orderDraftTitle(draft) };
}

/** An order from a sentence: read by the model when there is one, as one line when not. */
export async function makeShoppingOrder(text: string): Promise<ShoppingMade> {
  const user = await requireUser();
  const supabase = await createClient();
  const day = await today(supabase, user.id);
  const key = apiKey();
  let draft: OrderDraft | null = null;
  if (key) {
    const spend: SpendReport[] = [];
    draft = await readOrderSentence(text, day, {
      client: new Anthropic({ apiKey: key }),
      onSpend: (report) => spend.push(report),
    });
    await recordSessionSpend(user.id, { module: 'shopping', operation: 'read-order-sentence' }, spend);
  }
  return saveOrder(supabase, user.id, draft ?? orderFromSentenceAlone(text, day));
}

/** Something owned: a book when what was typed is an ISBN, and by its name otherwise. */
export async function makeShoppingItem(text: string): Promise<ShoppingMade> {
  const isbn = typedIsbn(text);
  if (isbn) {
    const form = new FormData();
    form.set('query', isbn);
    const saved = await saveOwnedBook({}, form);
    const id = saved.savedIds?.[0];
    if (!id) {
      return { ok: false, error: saved.error ?? 'No catalog lists that ISBN yet. Type the title instead.' };
    }
    return { ok: true, id, title: saved.book?.title ?? `ISBN ${isbn}` };
  }
  const form = new FormData();
  form.set('name', text.split('\n')[0].trim().slice(0, 300));
  const saved = await saveManualItem({}, form);
  if (!saved.savedId) return { ok: false, error: saved.error ?? 'It could not be added. Try again.' };
  return { ok: true, id: saved.savedId, title: String(form.get('name')) };
}

/**
 * A saved thing from its link: the page's title, picture and price when it
 * can be read, and its address as the title when it cannot.
 */
export async function makeShoppingSaved(text: string): Promise<ShoppingMade> {
  const link = linkIn(text);
  if (!link) return { ok: false, error: 'Paste the link to it.' };
  const user = await requireUser();
  const supabase = await createClient();

  let scraped: Awaited<ReturnType<typeof scrapeProductUrl>> | null = null;
  try {
    scraped = await scrapeProductUrl(link.url);
  } catch {
    // A page that cannot be read is still worth keeping by its address.
  }
  const url = scraped?.url ?? link.url;
  const title = scraped?.title?.trim() || linkTitle(url);

  const { data: merchants } = await supabase.from('merchants').select('id, slug, name, domains');
  const merchant = findMerchantByUrl(
    url,
    ((merchants ?? []) as { id: string; slug: string; name: string; domains: string[] | null }[]).map((row) => ({
      ...row,
      domains: row.domains ?? [],
    })),
  );

  const { data, error } = await supabase
    .from('saved_items')
    .insert({
      user_id: user.id,
      url,
      title,
      image_url: scraped?.imageUrl ?? null,
      price_cents: scraped?.priceCents ?? null,
      currency: scraped?.currency ?? 'USD',
      notes: link.note,
      merchant_id: merchant?.id ?? null,
      fingerprint_loose: fingerprintLoose(title),
      status: 'saved',
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('capture: the saved thing could not be written', error?.message);
    return { ok: false, error: 'It could not be saved. Try again.' };
  }
  return { ok: true, id: (data as { id: string }).id, title };
}

/**
 * An order read from a receipt photo (plan #1950.3.2): one press reads it and
 * makes it, and its own page is where a misread line is put right.
 */
export async function makeShoppingReceipt(photo: string): Promise<ShoppingMade> {
  const user = await requireUser();
  const read = await readReceiptPhoto(user.id, photo);
  if (!read.ok) return { ok: false, error: read.error };
  return saveReceiptOrder(await createClient(), user.id, read.order);
}

/**
 * What a scanned barcode names (plan #1950.3.2): a book from the catalogs
 * when it is an ISBN, and a game from the barcode database and BoardGameGeek
 * otherwise. Looked up when the scan lands, so the panel shows what Add will
 * add before it is pressed.
 */
export async function nameShoppingBarcode(code: string): Promise<{ ok: true; thing: ScannedThing } | { ok: false; error: string }> {
  const scanned = classifyScannedCode(code);
  if (!scanned) return { ok: false, error: 'That barcode did not read cleanly. Scan it again, or type the name.' };

  const query = new FormData();
  if (scanned.kind === 'isbn') {
    query.set('query', scanned.isbn13);
    const found = await searchOwnedBook({}, query);
    if (!found.book) {
      return { ok: false, error: found.error ?? 'No catalog lists that book yet. Type its title instead.' };
    }
    const book = found.book;
    return {
      ok: true,
      thing: {
        kind: 'book',
        title: book.title,
        byline: book.authors.length > 0 ? book.authors.join(', ') : null,
        image: book.coverUrl,
        code: scanned.isbn13,
        record: JSON.stringify(book),
      },
    };
  }

  query.set('query', scanned.ean13);
  const found = await searchGame({}, query);
  if (!found.game) {
    return { ok: false, error: found.error ?? 'Nothing is listed under that barcode. Type the name instead.' };
  }
  const game = found.game;
  const byline = [game.yearPublished, game.publisher].filter(Boolean).join(' · ');
  return {
    ok: true,
    thing: {
      kind: 'game',
      title: game.title,
      byline: byline || null,
      image: game.imageUrl,
      code: scanned.ean13,
      record: JSON.stringify(game),
    },
  };
}

/** The book or game a scan named, added to what is owned. */
export async function makeShoppingScanned(thing: ScannedThing): Promise<ShoppingMade> {
  const form = new FormData();
  // A scanned ISBN names the edition exactly, as the book scanner treated it;
  // a game's barcode can match more than one edition, so its row may still ask.
  form.set('force_confirmed', thing.kind === 'book' ? 'true' : 'false');
  if (thing.kind === 'book') {
    form.set('book_json', thing.record);
    form.set('source', 'manual');
    const saved = await saveOwnedBook({}, form);
    const id = saved.savedIds?.[0];
    if (!id) return { ok: false, error: saved.error ?? 'The book could not be added. Try again.' };
    return { ok: true, id, title: saved.book?.title ?? thing.title };
  }
  form.set('game_json', thing.record);
  const saved = await saveGame({}, form);
  const id = saved.savedIds?.[0];
  if (!id) return { ok: false, error: saved.error ?? 'The game could not be added. Try again.' };
  return { ok: true, id, title: saved.game?.title ?? thing.title };
}
