'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { domainFromAddress } from '@/lib/email/extract/classify';
import { restoreOrders } from '@/lib/review/moves';
import { tagOrderItem, untagOrderItem } from '@/lib/tags/ensure';

/**
 * Mute a merchant forever + remove their existing orders.
 * One click from order detail: clear the noise and don't bring it back on import.
 */
// latency: pending
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
    .from('inbox_messages')
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

  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/inventory');
  revalidatePath('/finances/spending');
  revalidatePath('/shopping/settings');
  revalidatePath('/shopping/review');
  redirect('/shopping/orders');
}

// latency: pending
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

  revalidatePath('/shopping/settings');
  revalidatePath('/shopping/orders');
}

/**
 * Soft-delete an order (and its inventory from active views). Restorable from
 * Settings → Deleted orders.
 *
 * Returns `{ ok: true }` on success so client callers can navigate/refresh.
 * Throws only for unexpected failures; returns `{ error }` for expected ones.
 */
// latency: pending
export async function softDeleteOrder(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  const supabase = await createClient();
  const orderId = String(formData.get('orderId') ?? '');
  if (!z.string().uuid().safeParse(orderId).success) {
    return { ok: false, error: 'Invalid order.' };
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', orderId)
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) {
    return {
      ok: false,
      error: 'Could not delete that order. It may already be deleted, or you may need to refresh and try again.',
    };
  }

  revalidatePath('/shopping/orders');
  revalidatePath(`/shopping/orders/${orderId}`);
  revalidatePath('/shopping/inventory');
  revalidatePath('/finances/spending');
  revalidatePath('/shopping/returns');
  revalidatePath('/shopping/review');
  revalidatePath('/shopping/settings');
  return { ok: true };
}

// latency: pending
export async function restoreDeletedOrder(formData: FormData): Promise<void> {
  const user = await requireUser();
  const supabase = await createClient();
  const orderId = String(formData.get('orderId') ?? '');
  if (!z.string().uuid().safeParse(orderId).success) {
    throw new Error('Invalid order.');
  }

  const restored = await restoreOrders(supabase, { userId: user.id, ids: [orderId], reviewAgain: false });
  if (!restored.ok) throw new Error(restored.error);

  revalidatePath('/shopping/orders');
  revalidatePath(`/shopping/orders/${orderId}`);
  revalidatePath('/shopping/inventory');
  revalidatePath('/finances/spending');
  revalidatePath('/shopping/returns');
  revalidatePath('/shopping/review');
  revalidatePath('/shopping/settings');
  redirect(`/shopping/orders/${orderId}`);
}

/** Permanently remove a soft-deleted order (cascades items + inventory). */
// latency: pending
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

  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/inventory');
  revalidatePath('/finances/spending');
  revalidatePath('/shopping/settings');
}

// latency: pending
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

  const tagged = await tagOrderItem(supabase, { userId: user.id, orderItemId: parsed.data.orderItemId, label: parsed.data.tag });
  if (!tagged) return;

  revalidatePath(`/shopping/orders/${parsed.data.orderId}`);
  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/settings');
}

// latency: pending
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
  const removed = await untagOrderItem(supabase, { userId: user.id, orderItemId: parsed.data.orderItemId, tagId: parsed.data.tagId });
  if (removed.length === 0) return;

  revalidatePath(`/shopping/orders/${parsed.data.orderId}`);
  revalidatePath('/shopping/orders');
  revalidatePath('/shopping/settings');
}
