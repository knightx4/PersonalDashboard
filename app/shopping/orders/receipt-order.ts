/**
 * An order from a receipt photo: the read and the write, apart from the pages
 * that use them so capture can make the order in one press (plan #1950.3.2)
 * and the receipt page can still show the read before saving.
 *
 * Server-only rather than 'use server': the write takes a client, and an
 * export from a 'use server' file is an endpoint anyone can call.
 */
import 'server-only';

import { createClient } from '@/lib/auth/server';
import { buildOwnedBookRows } from '@/lib/books/create-owned-book';
import { extractOrderFromReceiptPhoto } from '@/lib/books/receipt-photo';
import { resolveBook } from '@/lib/books/resolve';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { CATEGORY_SLUGS } from '@/lib/email/extract/schema';
import { serverEnv } from '@/lib/env';
import { buildManualOrder } from '@/lib/orders/create-manual-order';
import { ensureItemTags, linkOrderItemTags } from '@/lib/tags/ensure';

type Client = Awaited<ReturnType<typeof createClient>>;

/** What the read finds on a receipt, as the save takes it. */
export type ReceiptExtraction = {
  merchantName?: string | null;
  merchantSlug?: string | null;
  externalOrderNumber?: string | null;
  orderDate: string;
  currency?: string;
  taxCents: number;
  shippingCents: number;
  discountCents: number;
  totalCents: number;
  lines: {
    name: string;
    shortName?: string | null;
    variant?: string | null;
    quantity: number;
    unitPriceCents: number;
    categorySlug?: string | null;
    searchTags?: string[] | null;
    tags?: string[] | null;
  }[];
};

function envKeys() {
  try {
    const env = serverEnv();
    return {
      anthropicApiKey: env.ANTHROPIC_API_KEY ?? null,
      googleBooksApiKey: env.GOOGLE_BOOKS_API_KEY ?? null,
    };
  } catch {
    return {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? null,
      googleBooksApiKey: process.env.GOOGLE_BOOKS_API_KEY ?? null,
    };
  }
}

/** Read a receipt photo as an order, recording what the read cost. */
export async function readReceiptPhoto(
  userId: string,
  imageDataUrl: string,
): Promise<{ ok: true; order: ReceiptExtraction } | { ok: false; error: string }> {
  const keys = envKeys();
  if (!keys.anthropicApiKey) return { ok: false, error: 'Receipt photos need ANTHROPIC_API_KEY on the server.' };
  if (!imageDataUrl) return { ok: false, error: 'Choose a receipt photo.' };

  const spend: SpendReport[] = [];
  const result = await extractOrderFromReceiptPhoto({
    imageDataUrl,
    apiKey: keys.anthropicApiKey,
    onSpend: (report) => spend.push(report),
    categories: CATEGORY_SLUGS.map((slug) => ({ slug, name: slug.charAt(0).toUpperCase() + slug.slice(1) })),
  });
  await recordSessionSpend(userId, { module: 'shopping', operation: 'read-receipt-photo' }, spend);

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === 'reconcile'
          ? 'The receipt totals did not add up. Try a clearer photo.'
          : (result.issues?.[0] ?? 'That receipt could not be read. Try a clearer photo.'),
    };
  }
  return { ok: true, order: result.order };
}

/** What to call an order read from a receipt: its first line, and its shop. */
export function receiptOrderTitle(order: ReceiptExtraction): string {
  const [first, ...rest] = order.lines;
  const name = first?.name ?? 'Receipt';
  const more = rest.length > 0 ? ` and ${rest.length} more` : '';
  return order.merchantName ? `${name}${more} from ${order.merchantName}` : `${name}${more}`;
}

/**
 * Write the order a receipt was read as: its lines, one inventory item per
 * unit, and book details for lines that look like books. A failure part way
 * takes the order back out.
 */
export async function saveReceiptOrder(
  supabase: Client,
  userId: string,
  extraction: ReceiptExtraction,
): Promise<{ ok: true; id: string; title: string } | { ok: false; error: string }> {
  const { data: categories } = await supabase.from('categories').select('id, slug, name').is('parent_id', null);
  const bySlug = new Map((categories ?? []).map((c) => [c.slug as string, c]));

  let merchantId: string | null = null;
  let merchantSlug: string | null = extraction.merchantSlug ?? null;
  if (extraction.merchantName) {
    const slug =
      merchantSlug ??
      extraction.merchantName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
    const { data: existing } = await supabase
      .from('merchants')
      .select('id, slug')
      .eq('slug', `${slug}-${userId.slice(0, 8)}`)
      .maybeSingle();
    if (existing) {
      merchantId = existing.id;
      merchantSlug = existing.slug;
    } else {
      const { data: created } = await supabase
        .from('merchants')
        .insert({
          name: extraction.merchantName,
          slug: `${slug || 'merchant'}-${userId.slice(0, 8)}`,
          created_by_user_id: userId,
          is_global: false,
        })
        .select('id, slug')
        .single();
      if (created) {
        merchantId = created.id;
        merchantSlug = created.slug;
      }
    }
  }

  const built = buildManualOrder({
    userId,
    merchantId,
    merchantSlug,
    externalOrderNumber: extraction.externalOrderNumber,
    orderDate: extraction.orderDate,
    taxCents: extraction.taxCents,
    shippingCents: extraction.shippingCents,
    discountCents: extraction.discountCents,
    currency: extraction.currency,
    source: 'receipt_photo',
    lines: extraction.lines.map((line) => {
      const cat = line.categorySlug ? bySlug.get(line.categorySlug) : undefined;
      return {
        name: line.name,
        variant: line.variant,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        categoryId: cat?.id,
        categorySlug: cat?.slug ?? line.categorySlug ?? null,
        categoryName: cat?.name ?? null,
      };
    }),
  });

  const { error: orderError } = await supabase.from('orders').insert({
    id: built.order.id,
    user_id: built.order.userId,
    merchant_id: built.order.merchantId,
    source: 'receipt_photo',
    external_order_number: built.order.externalOrderNumber,
    order_date: built.order.orderDate,
    subtotal_cents: built.order.subtotalCents,
    tax_cents: built.order.taxCents,
    shipping_cents: built.order.shippingCents,
    discount_cents: built.order.discountCents,
    total_cents: built.order.totalCents,
    currency: built.order.currency,
  });
  if (orderError) {
    console.error('receipt: the order could not be written', orderError.message);
    return { ok: false, error: 'The order could not be added. Try again.' };
  }

  const takeBack = async () => {
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
  if (itemsError) return takeBack();

  for (const item of built.orderItems) {
    if (item.tags.length === 0) continue;
    try {
      const resolved = await ensureItemTags(supabase, userId, item.tags);
      await linkOrderItemTags(
        supabase,
        item.id,
        resolved.map((tag) => tag.id),
      );
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
      source: 'receipt_photo',
    })),
  );
  if (inventoryError) return takeBack();

  // Book details for book lines, where a catalog knows the book.
  const keys = envKeys();
  const booksCat = bySlug.get('books');
  if (booksCat) {
    for (const inv of built.inventoryItems) {
      if (inv.categoryId !== booksCat.id) continue;
      const book = await resolveBook({ title: inv.name, author: inv.variant }, { googleBooksApiKey: keys.googleBooksApiKey });
      if (!book) continue;
      const rows = buildOwnedBookRows({
        userId,
        booksCategoryId: booksCat.id,
        book,
        acquiredAt: inv.acquiredAt,
        source: 'receipt_photo',
      });
      await supabase.from('book_details').insert({
        id: rows.bookDetails.id,
        inventory_item_id: inv.id,
        isbn_13: rows.bookDetails.isbn13,
        isbn_10: rows.bookDetails.isbn10,
        authors: rows.bookDetails.authors,
        edition: rows.bookDetails.edition,
        publisher: rows.bookDetails.publisher,
        published_year: rows.bookDetails.publishedYear,
        weight_grams: null,
        condition: null,
        resolution_source: rows.bookDetails.resolutionSource,
        match_confidence: rows.bookDetails.matchConfidence,
        needs_confirmation: rows.bookDetails.needsConfirmation,
      });
      if (book.coverUrl) {
        await supabase.from('inventory_items').update({ image_url: book.coverUrl }).eq('id', inv.id);
      }
    }
  }

  return { ok: true, id: built.order.id, title: receiptOrderTitle(extraction) };
}
