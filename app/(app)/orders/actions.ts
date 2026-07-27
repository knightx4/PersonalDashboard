'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { parseDollarsToCents } from '@/lib/money';
import { buildManualOrder } from '@/lib/orders/create-manual-order';

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

  const built = buildManualOrder({
    userId: user.id,
    merchantId,
    merchantSlug,
    externalOrderNumber: data.externalOrderNumber,
    orderDate: data.orderDate,
    taxCents: data.tax,
    shippingCents: data.shipping,
    discountCents: data.discount,
    lines: data.lines.map((line) => ({
      name: line.name,
      variant: line.variant,
      quantity: line.quantity,
      unitPriceCents: line.unitPrice,
      categoryId: line.categoryId,
    })),
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

  const { error: inventoryError } = await supabase.from('inventory_items').insert(
    built.inventoryItems.map((item) => ({
      id: item.id,
      user_id: item.userId,
      order_item_id: item.orderItemId,
      category_id: item.categoryId,
      name: item.name,
      variant: item.variant,
      fingerprint_loose: item.fingerprintLoose,
      acquired_at: item.acquiredAt,
      cost_cents: item.costCents,
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
