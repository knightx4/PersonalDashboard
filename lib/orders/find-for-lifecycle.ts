import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export type LifecycleOrderHit = {
  id: string;
  merchantId: string | null;
  externalOrderNumber: string | null;
  cancelledAt: string | null;
};

/**
 * Resolve which order a shipping/delivery/return/cancel email belongs to.
 * Prefer thread linkage (same Gmail thread as the confirmation), then
 * merchant + order number, then order number alone for the user.
 */
export async function findOrderForLifecycleEmail(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    merchantId?: string | null;
    externalOrderNumber?: string | null;
    threadId?: string | null;
  },
): Promise<LifecycleOrderHit | null> {
  if (opts.threadId) {
    const { data: threadHit } = await supabase
      .from('ingested_messages')
      .select('resulting_order_id')
      .eq('thread_id', opts.threadId)
      .not('resulting_order_id', 'is', null)
      .limit(1)
      .maybeSingle();

    if (threadHit?.resulting_order_id) {
      const { data: order } = await supabase
        .from('orders')
        .select('id, merchant_id, external_order_number, cancelled_at')
        .eq('id', threadHit.resulting_order_id)
        .eq('user_id', opts.userId)
        .maybeSingle();
      if (order) {
        return {
          id: order.id,
          merchantId: order.merchant_id,
          externalOrderNumber: order.external_order_number,
          cancelledAt: order.cancelled_at,
        };
      }
    }
  }

  const orderNumber = opts.externalOrderNumber?.trim();
  if (!orderNumber) return null;

  let query = supabase
    .from('orders')
    .select('id, merchant_id, external_order_number, cancelled_at')
    .eq('user_id', opts.userId)
    .eq('external_order_number', orderNumber)
    .order('order_date', { ascending: false })
    .limit(5);

  if (opts.merchantId) {
    query = query.eq('merchant_id', opts.merchantId);
  }

  const { data: rows } = await query;
  if (!rows || rows.length === 0) {
    // Case-insensitive fallback — some merchants vary casing on resends.
    const { data: loose } = await supabase
      .from('orders')
      .select('id, merchant_id, external_order_number, cancelled_at')
      .eq('user_id', opts.userId)
      .ilike('external_order_number', orderNumber)
      .order('order_date', { ascending: false })
      .limit(5);
    if (!loose || loose.length === 0) return null;
    const preferred =
      (opts.merchantId
        ? loose.find((row) => row.merchant_id === opts.merchantId)
        : null) ?? loose[0];
    return {
      id: preferred.id,
      merchantId: preferred.merchant_id,
      externalOrderNumber: preferred.external_order_number,
      cancelledAt: preferred.cancelled_at,
    };
  }

  return {
    id: rows[0].id,
    merchantId: rows[0].merchant_id,
    externalOrderNumber: rows[0].external_order_number,
    cancelledAt: rows[0].cancelled_at,
  };
}
