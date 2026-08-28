'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { extractOrderFromReceiptPhoto } from '@/lib/books/receipt-photo';
import { resolveBook } from '@/lib/books/resolve';
import { buildOwnedBookRows } from '@/lib/books/create-owned-book';
import { CATEGORY_SLUGS } from '@/lib/email/extract/schema';
import { serverEnv } from '@/lib/env';
import { buildManualOrder } from '@/lib/orders/create-manual-order';
import { ensureItemTags, linkOrderItemTags } from '@/lib/tags/ensure';

export type ReceiptActionState = {
  error?: string;
  message?: string;
  preview?: {
    merchantName: string | null;
    orderDate: string;
    totalCents: number;
    lines: { name: string; quantity: number; unitPriceCents: number; categorySlug: string | null }[];
  };
  rawOrder?: string;
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

export async function previewReceiptPhoto(
  _prev: ReceiptActionState,
  formData: FormData,
): Promise<ReceiptActionState> {
  await requireUser();
  const keys = envKeys();
  if (!keys.anthropicApiKey) {
    return { error: 'Receipt photos need ANTHROPIC_API_KEY on the server.' };
  }

  const dataUrl = String(formData.get('image_data_url') ?? '');
  if (!dataUrl) return { error: 'Choose a receipt photo.' };

  const result = await extractOrderFromReceiptPhoto({
    imageDataUrl: dataUrl,
    apiKey: keys.anthropicApiKey,
    categories: CATEGORY_SLUGS.map((slug) => ({
      slug,
      name: slug.charAt(0).toUpperCase() + slug.slice(1),
    })),
  });

  if (!result.ok) {
    return {
      error:
        result.reason === 'reconcile'
          ? 'Receipt totals did not add up. Try a clearer photo.'
          : (result.issues?.[0] ?? 'Could not extract that receipt.'),
    };
  }

  return {
    message: 'Review the extracted order, then save.',
    preview: {
      merchantName: result.order.merchantName ?? null,
      orderDate: result.order.orderDate,
      totalCents: result.order.totalCents,
      lines: result.order.lines.map((line) => ({
        name: line.name,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        categorySlug: line.categorySlug ?? null,
      })),
    },
    rawOrder: JSON.stringify(result.order),
  };
}

export async function saveReceiptPhotoOrder(
  _prev: ReceiptActionState,
  formData: FormData,
): Promise<ReceiptActionState> {
  const user = await requireUser();
  const supabase = await createClient();
  const raw = String(formData.get('raw_order') ?? '');
  if (!raw) return { error: 'Nothing to save.' };

  let extraction: {
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

  try {
    extraction = JSON.parse(raw);
  } catch {
    return { error: 'Invalid order payload.' };
  }

  const { data: categories } = await supabase
    .from('categories')
    .select('id, slug, name')
    .is('parent_id', null);
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
      .eq('slug', `${slug}-${user.id.slice(0, 8)}`)
      .maybeSingle();
    if (existing) {
      merchantId = existing.id;
      merchantSlug = existing.slug;
    } else {
      const { data: created } = await supabase
        .from('merchants')
        .insert({
          name: extraction.merchantName,
          slug: `${slug || 'merchant'}-${user.id.slice(0, 8)}`,
          created_by_user_id: user.id,
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
    userId: user.id,
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
  if (orderError) return { error: orderError.message };

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
  if (itemsError) {
    await supabase.from('orders').delete().eq('id', built.order.id);
    return { error: itemsError.message };
  }

  for (const item of built.orderItems) {
    if (item.tags.length === 0) continue;
    try {
      const resolved = await ensureItemTags(supabase, user.id, item.tags);
      await linkOrderItemTags(
        supabase,
        item.id,
        resolved.map((tag) => tag.id),
      );
    } catch {
      // best-effort
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
  if (inventoryError) {
    await supabase.from('orders').delete().eq('id', built.order.id);
    return { error: inventoryError.message };
  }

  // Attach book_details for book lines when resolvable.
  const keys = envKeys();
  const booksCat = bySlug.get('books');
  if (booksCat) {
    for (const inv of built.inventoryItems) {
      if (inv.categoryId !== booksCat.id) continue;
      const book = await resolveBook(
        { title: inv.name, author: inv.variant },
        { googleBooksApiKey: keys.googleBooksApiKey },
      );
      if (!book) continue;
      const rows = buildOwnedBookRows({
        userId: user.id,
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
        await supabase
          .from('inventory_items')
          .update({ image_url: book.coverUrl })
          .eq('id', inv.id);
      }
    }
  }

  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/inventory');
  revalidatePath('/shopping/dashboard');
  redirect(`/shopping/orders/${built.order.id}`);
}
