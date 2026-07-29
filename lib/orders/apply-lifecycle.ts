import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { MessageClassification } from '@/lib/email/extract/schema';
import type { LifecycleExtraction } from '@/lib/email/extract/lifecycle';
import type { LifecycleOrderHit } from '@/lib/orders/find-for-lifecycle';
import { todayInTimezone } from '@/lib/money';

function nameMatchesHint(name: string, hints: string[]): boolean {
  if (hints.length === 0) return false;
  const hay = name.toLowerCase();
  return hints.some((hint) => {
    const needle = hint.toLowerCase().trim();
    if (needle.length < 3) return false;
    return hay.includes(needle) || needle.includes(hay.slice(0, Math.min(hay.length, 40)));
  });
}

async function upsertShipment(
  supabase: SupabaseClient,
  opts: {
    orderId: string;
    extraction: LifecycleExtraction;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { orderId, extraction } = opts;
  const tracking = extraction.trackingNumber;

  if (tracking) {
    const { data: existing } = await supabase
      .from('shipments')
      .select('id, status, shipped_at, delivered_at, carrier, tracking_url')
      .eq('order_id', orderId)
      .eq('tracking_number', tracking)
      .maybeSingle();

    if (existing) {
      const nextStatus =
        existing.status === 'delivered' ? 'delivered' : extraction.shipmentStatus;
      const { error } = await supabase
        .from('shipments')
        .update({
          status: nextStatus,
          carrier: extraction.carrier ?? existing.carrier,
          tracking_url: extraction.trackingUrl ?? existing.tracking_url,
          shipped_at: extraction.shippedAt ?? existing.shipped_at,
          delivered_at:
            nextStatus === 'delivered'
              ? (extraction.deliveredAt ?? existing.delivered_at ?? extraction.shippedAt)
              : existing.delivered_at,
        })
        .eq('id', existing.id);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }

    const { error } = await supabase.from('shipments').insert({
      order_id: orderId,
      carrier: extraction.carrier,
      tracking_number: tracking,
      tracking_url: extraction.trackingUrl,
      status: extraction.shipmentStatus,
      shipped_at: extraction.shippedAt,
      delivered_at:
        extraction.shipmentStatus === 'delivered' ? extraction.deliveredAt : null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  // No tracking number — update the latest open shipment, or create one.
  const { data: open } = await supabase
    .from('shipments')
    .select('id, status, shipped_at, delivered_at, carrier, tracking_url')
    .eq('order_id', orderId)
    .neq('status', 'delivered')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (open) {
    const nextStatus =
      open.status === 'delivered' ? 'delivered' : extraction.shipmentStatus;
    const { error } = await supabase
      .from('shipments')
      .update({
        status: nextStatus,
        carrier: extraction.carrier ?? open.carrier,
        tracking_url: extraction.trackingUrl ?? open.tracking_url,
        shipped_at: extraction.shippedAt ?? open.shipped_at,
        delivered_at:
          nextStatus === 'delivered'
            ? (extraction.deliveredAt ?? open.delivered_at ?? extraction.shippedAt)
            : open.delivered_at,
      })
      .eq('id', open.id);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  if (extraction.shipmentStatus === 'delivered') {
    const { data: anyShipment } = await supabase
      .from('shipments')
      .select('id, delivered_at, shipped_at, carrier, tracking_url, status')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (anyShipment) {
      const { error } = await supabase
        .from('shipments')
        .update({
          status: 'delivered',
          carrier: extraction.carrier ?? anyShipment.carrier,
          tracking_url: extraction.trackingUrl ?? anyShipment.tracking_url,
          shipped_at: extraction.shippedAt ?? anyShipment.shipped_at,
          delivered_at:
            extraction.deliveredAt ?? anyShipment.delivered_at ?? extraction.shippedAt,
        })
        .eq('id', anyShipment.id);
      if (error) return { ok: false, error: error.message };
      return { ok: true };
    }
  }

  const { error } = await supabase.from('shipments').insert({
    order_id: orderId,
    carrier: extraction.carrier,
    tracking_number: null,
    tracking_url: extraction.trackingUrl,
    status: extraction.shipmentStatus,
    shipped_at: extraction.shippedAt,
    delivered_at:
      extraction.shipmentStatus === 'delivered' ? extraction.deliveredAt : null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function applyReturnFromEmail(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    orderId: string;
    extraction: LifecycleExtraction;
    sourceMessageId: string;
    timezone: string;
  },
): Promise<{ ok: true; units: number } | { ok: false; error: string }> {
  const { data: already } = await supabase
    .from('returns')
    .select('id')
    .eq('source_message_id', opts.sourceMessageId)
    .limit(1)
    .maybeSingle();
  if (already) return { ok: true, units: 0 };

  const { data: orderItems } = await supabase
    .from('order_items')
    .select('id')
    .eq('order_id', opts.orderId);
  const orderItemIds = (orderItems ?? []).map((row) => row.id);
  if (orderItemIds.length === 0) {
    return { ok: false, error: 'No owned units left to mark returned' };
  }

  const { data: units } = await supabase
    .from('inventory_items')
    .select('id, name, cost_cents, status, order_item_id')
    .eq('user_id', opts.userId)
    .eq('status', 'owned')
    .in('order_item_id', orderItemIds);

  const owned = units ?? [];
  if (owned.length === 0) {
    return { ok: false, error: 'No owned units left to mark returned' };
  }

  const hints = opts.extraction.itemNameHints;
  const matched = hints.length > 0 ? owned.filter((u) => nameMatchesHint(u.name, hints)) : [];
  const targets = matched.length > 0 ? matched : owned;

  const today = todayInTimezone(opts.timezone);
  const refundTotal = opts.extraction.refundAmountCents;
  const rows = targets.map((unit, index) => ({
    user_id: opts.userId,
    order_id: opts.orderId,
    inventory_item_id: unit.id,
    initiated_at: today,
    refund_amount_cents:
      refundTotal != null && targets.length === 1
        ? refundTotal
        : refundTotal != null && index === 0
          ? refundTotal
          : unit.cost_cents,
    status: 'refunded' as const,
    refunded_at: today,
    source_message_id: opts.sourceMessageId,
  }));

  // When splitting a known refund across many units, only the first row carries
  // the extracted total; others use sticker cost — clamp first if we already
  // assigned full refund to avoid double-counting. (Above: first gets refundTotal.)
  if (refundTotal != null && targets.length > 1) {
    for (let i = 1; i < rows.length; i++) {
      rows[i].refund_amount_cents = 0;
    }
  }

  const { error } = await supabase.from('returns').insert(rows);
  if (error) return { ok: false, error: error.message };
  return { ok: true, units: rows.length };
}

/**
 * Apply a classified lifecycle email onto an existing order.
 * Never writes orders.status directly — shipments / returns / cancelled_at
 * drive sync_order_state via triggers.
 */
export async function applyLifecycleToOrder(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    order: LifecycleOrderHit;
    classification: MessageClassification;
    extraction: LifecycleExtraction;
    sourceMessageId: string;
    receivedAt: Date | null;
    timezone?: string;
  },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const timezone = opts.timezone ?? 'UTC';

  if (opts.classification === 'cancellation') {
    if (!opts.order.cancelledAt) {
      const { error } = await supabase
        .from('orders')
        .update({
          cancelled_at: (opts.receivedAt ?? new Date()).toISOString(),
        })
        .eq('id', opts.order.id)
        .eq('user_id', opts.userId);
      if (error) return { ok: false, error: error.message };
    }
    return { ok: true };
  }

  if (opts.classification === 'shipping' || opts.classification === 'delivery') {
    return upsertShipment(supabase, {
      orderId: opts.order.id,
      extraction: opts.extraction,
    });
  }

  if (opts.classification === 'return') {
    const result = await applyReturnFromEmail(supabase, {
      userId: opts.userId,
      orderId: opts.order.id,
      extraction: opts.extraction,
      sourceMessageId: opts.sourceMessageId,
      timezone,
    });
    if (!result.ok) return result;
    return { ok: true };
  }

  return { ok: false, error: `Unsupported classification ${opts.classification}` };
}
