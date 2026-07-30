'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { domainFromAddress } from '@/lib/email/extract/classify';
import { parseDollarsToCents } from '@/lib/money';
import { buildManualOrder } from '@/lib/orders/create-manual-order';
import { ensureItemTags, linkOrderItemTags } from '@/lib/tags/ensure';

export interface ActionState {
  error?: string;
}

function moneyField(label: string, optional = false) {
  return z.string().transform((value, ctx) => {
    try {
      if (optional && value.trim() === '') return 0;
      return parseDollarsToCents(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: `${label} must be a dollar amount like 12.99.` });
      return z.NEVER;
    }
  });
}

const lineSchema = z.object({
  name: z.string().trim().min(1, 'Every line needs a name.'),
  variant: z.string().trim().optional(),
  quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1.'),
  unitPrice: moneyField('Unit price'),
  categoryId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

const createOrderSchema = z.object({
  merchantId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  customMerchantName: z.string().trim().optional(),
  externalOrderNumber: z.string().trim().optional(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick an order date.'),
  tax: moneyField('Tax', true),
  shipping: moneyField('Shipping', true),
  discount: moneyField('Discount', true),
  lines: z.array(lineSchema).min(1, 'Add at least one line item.'),
});

function parseLines(formData: FormData) {
  const names = formData.getAll('line_name');
  const variants = formData.getAll('line_variant');
  const quantities = formData.getAll('line_quantity');
  const unitPrices = formData.getAll('line_unit_price');
  const categoryIds = formData.getAll('line_category_id');

  return names.map((name, index) => ({
    name: String(name ?? ''),
    variant: String(variants[index] ?? ''),
    quantity: String(quantities[index] ?? '1'),
    unitPrice: String(unitPrices[index] ?? ''),
    categoryId: String(categoryIds[index] ?? ''),
  }));
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function createManualOrder(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const supabase = await createClient();

  const parsed = createOrderSchema.safeParse({
    merchantId: formData.get('merchant_id') ?? '',
    customMerchantName: String(formData.get('custom_merchant_name') ?? ''),
    externalOrderNumber: String(formData.get('external_order_number') ?? ''),
    orderDate: String(formData.get('order_date') ?? ''),
    tax: String(formData.get('tax') ?? ''),
    shipping: String(formData.get('shipping') ?? ''),
    discount: String(formData.get('discount') ?? ''),
    lines: parseLines(formData),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Check the form and try again.' };
  }

  const data = parsed.data;
  let merchantId: string | null = data.merchantId ?? null;
  let merchantSlug: string | null = null;

  if (merchantId) {
    const { data: merchant, error } = await supabase
      .from('merchants')
      .select('id, slug')
      .eq('id', merchantId)
      .maybeSingle();
    if (error || !merchant) return { error: 'That merchant could not be found.' };
    merchantSlug = merchant.slug;
  } else if (data.customMerchantName) {
    const name = data.customMerchantName;
    const slug = `${slugify(name) || 'merchant'}-${user.id.slice(0, 8)}`;
    const { data: created, error } = await supabase
      .from('merchants')
      .insert({
        name,
        slug,
        created_by_user_id: user.id,
        is_global: false,
      })
      .select('id, slug')
      .single();
    if (error || !created) {
      return { error: error?.message ?? 'Could not create that merchant.' };
    }
    merchantId = created.id;
    merchantSlug = created.slug;
  }

  const categoryIds = [
    ...new Set(data.lines.map((line) => line.categoryId).filter(Boolean)),
  ] as string[];
  const categoryMeta = new Map<string, { slug: string; name: string }>();
  if (categoryIds.length > 0) {
    const { data: cats } = await supabase
      .from('categories')
      .select('id, slug, name')
      .in('id', categoryIds);
    for (const cat of cats ?? []) {
      categoryMeta.set(cat.id, { slug: cat.slug, name: cat.name });
    }
  }

  const built = buildManualOrder({
    userId: user.id,
    merchantId,
    merchantSlug,
    externalOrderNumber: data.externalOrderNumber,
    orderDate: data.orderDate,
    taxCents: data.tax,
    shippingCents: data.shipping,
    discountCents: data.discount,
    lines: data.lines.map((line) => {
      const meta = line.categoryId ? categoryMeta.get(line.categoryId) : undefined;
      return {
        name: line.name,
        variant: line.variant,
        quantity: line.quantity,
        unitPriceCents: line.unitPrice,
        categoryId: line.categoryId,
        categorySlug: meta?.slug ?? null,
        categoryName: meta?.name ?? null,
      };
    }),
  });

  const { error: orderError } = await supabase.from('orders').insert({
    id: built.order.id,
    user_id: built.order.userId,
    merchant_id: built.order.merchantId,
    source: built.order.source,
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
      // Tag linking is best-effort; the order itself already saved.
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
    })),
  );
  if (inventoryError) {
    await supabase.from('orders').delete().eq('id', built.order.id);
    return { error: inventoryError.message };
  }

  revalidatePath('/orders');
  revalidatePath('/inventory');
  revalidatePath('/dashboard');
  redirect(`/orders/${built.order.id}`);
}

/**
 * Mute a merchant forever + remove their existing orders.
 * One click from order detail: clear the noise and don't bring it back on import.
 */
export async function excludeMerchantFromOrder(formData: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const orderId = String(formData.get('orderId') ?? '');
  if (!z.string().uuid().safeParse(orderId).success) {
    throw new Error('Invalid order.');
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id, merchant_id, merchants ( id, name, domains )')
    .eq('id', orderId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!order) throw new Error('Order not found.');

  const merchant = Array.isArray(order.merchants) ? order.merchants[0] : order.merchants;
  const merchantId = (order.merchant_id as string | null) ?? merchant?.id ?? null;

  const { data: sourceMessage } = await supabase
    .from('ingested_messages')
    .select('from_address')
    .eq('resulting_order_id', orderId)
    .maybeSingle();

  const fromDomain = domainFromAddress(sourceMessage?.from_address ?? null);
  const merchantDomain =
    Array.isArray(merchant?.domains) && merchant.domains.length > 0
      ? String(merchant.domains[0]).toLowerCase()
      : null;
  const matchDomain = fromDomain ?? merchantDomain;

  if (!merchantId && !matchDomain) {
    throw new Error('This order has no merchant to mute. Delete it manually if needed.');
  }

  let existingQuery = supabase
    .from('merchant_exclusions')
    .select('id')
    .eq('user_id', user.id);
  if (merchantId) existingQuery = existingQuery.eq('merchant_id', merchantId);
  else existingQuery = existingQuery.eq('match_domain', matchDomain!);

  const { data: existing } = await existingQuery.maybeSingle();
  if (!existing) {
    const { error: insertError } = await supabase.from('merchant_exclusions').insert({
      user_id: user.id,
      merchant_id: merchantId,
      match_domain: matchDomain,
    });
    if (insertError && !/duplicate|unique/i.test(insertError.message)) {
      throw new Error(insertError.message);
    }
  }

  // Remove every order from this merchant (or just this one if domain-only).
  let orderIds: string[] = [orderId];
  if (merchantId) {
    const { data: peers } = await supabase
      .from('orders')
      .select('id')
      .eq('user_id', user.id)
      .eq('merchant_id', merchantId);
    orderIds = (peers ?? []).map((row) => row.id as string);
  }

  if (orderIds.length > 0) {
    await supabase
      .from('ingested_messages')
      .update({
        parse_status: 'skipped',
        resulting_order_id: null,
        error: 'Excluded by user merchant mute',
      })
      .in('resulting_order_id', orderIds);
    await supabase.from('orders').delete().eq('user_id', user.id).in('id', orderIds);
  }

  revalidatePath('/orders');
  revalidatePath('/inventory');
  revalidatePath('/dashboard');
  revalidatePath('/settings');
  revalidatePath('/review');
  redirect('/orders');
}

export async function restoreMerchantExclusion(formData: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const exclusionId = String(formData.get('exclusionId') ?? '');
  if (!z.string().uuid().safeParse(exclusionId).success) {
    throw new Error('Invalid exclusion.');
  }

  const { error } = await supabase
    .from('merchant_exclusions')
    .delete()
    .eq('id', exclusionId)
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);

  revalidatePath('/settings');
  revalidatePath('/orders');
}

/**
 * Soft-delete an order (and its inventory from active views). Restorable from
 * Settings → Deleted orders.
 */
export async function softDeleteOrder(formData: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const orderId = String(formData.get('orderId') ?? '');
  if (!z.string().uuid().safeParse(orderId).success) {
    throw new Error('Invalid order.');
  }

  const { error } = await supabase
    .from('orders')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('user_id', user.id)
    .is('deleted_at', null);

  if (error) throw new Error(error.message);

  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/inventory');
  revalidatePath('/dashboard');
  revalidatePath('/returns');
  revalidatePath('/review');
  revalidatePath('/settings');
  redirect('/orders');
}

export async function restoreDeletedOrder(formData: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const orderId = String(formData.get('orderId') ?? '');
  if (!z.string().uuid().safeParse(orderId).success) {
    throw new Error('Invalid order.');
  }

  const { error } = await supabase
    .from('orders')
    .update({ deleted_at: null })
    .eq('id', orderId)
    .eq('user_id', user.id)
    .not('deleted_at', 'is', null);

  if (error) throw new Error(error.message);

  revalidatePath('/orders');
  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/inventory');
  revalidatePath('/dashboard');
  revalidatePath('/returns');
  revalidatePath('/review');
  revalidatePath('/settings');
  redirect(`/orders/${orderId}`);
}

/** Permanently remove a soft-deleted order (cascades items + inventory). */
export async function permanentlyDeleteOrder(formData: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const orderId = String(formData.get('orderId') ?? '');
  if (!z.string().uuid().safeParse(orderId).success) {
    throw new Error('Invalid order.');
  }

  const { data: order } = await supabase
    .from('orders')
    .select('id')
    .eq('id', orderId)
    .eq('user_id', user.id)
    .not('deleted_at', 'is', null)
    .maybeSingle();
  if (!order) throw new Error('Deleted order not found.');

  await supabase
    .from('ingested_messages')
    .update({ resulting_order_id: null })
    .eq('resulting_order_id', orderId);

  const { error } = await supabase
    .from('orders')
    .delete()
    .eq('id', orderId)
    .eq('user_id', user.id);

  if (error) throw new Error(error.message);

  revalidatePath('/orders');
  revalidatePath('/inventory');
  revalidatePath('/dashboard');
  revalidatePath('/settings');
}

export async function addOrderItemTag(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z
    .object({
      orderId: z.string().uuid(),
      orderItemId: z.string().uuid(),
      tag: z.string().trim().min(2).max(40),
    })
    .safeParse({
      orderId: formData.get('orderId'),
      orderItemId: formData.get('orderItemId'),
      tag: formData.get('tag'),
    });
  if (!parsed.success) return;

  const supabase = await createClient();
  const { data: item } = await supabase
    .from('order_items')
    .select('id, orders!inner ( id, user_id )')
    .eq('id', parsed.data.orderItemId)
    .eq('order_id', parsed.data.orderId)
    .eq('orders.user_id', user.id)
    .maybeSingle();
  if (!item) return;

  const [tag] = await ensureItemTags(supabase, user.id, [parsed.data.tag]);
  if (!tag) return;
  await linkOrderItemTags(supabase, parsed.data.orderItemId, [tag.id]);

  revalidatePath(`/orders/${parsed.data.orderId}`);
  revalidatePath('/orders');
  revalidatePath('/settings');
}

export async function removeOrderItemTag(input: {
  orderId: string;
  orderItemId: string;
  tagId: string;
}): Promise<void> {
  const user = await requireUser();
  const parsed = z
    .object({
      orderId: z.string().uuid(),
      orderItemId: z.string().uuid(),
      tagId: z.string().uuid(),
    })
    .safeParse(input);
  if (!parsed.success) return;

  const supabase = await createClient();
  const { data: owned } = await supabase
    .from('item_tags')
    .select('id')
    .eq('id', parsed.data.tagId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!owned) return;

  await supabase
    .from('order_item_tags')
    .delete()
    .eq('order_item_id', parsed.data.orderItemId)
    .eq('tag_id', parsed.data.tagId);

  revalidatePath(`/orders/${parsed.data.orderId}`);
  revalidatePath('/orders');
  revalidatePath('/settings');
}
