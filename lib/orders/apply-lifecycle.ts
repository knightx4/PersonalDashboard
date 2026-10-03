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

type Row = Record<string, unknown>;

/**
 * What a lifecycle email changed, for the mail sync to record as Dash's
 * (plan #1577). Null when it changed nothing. The review page applies the
 * same email by the person's own hand and records nothing.
 */
export type LifecycleChange =
  | { what: 'shipment'; op: 'insert'; shipmentId: string }
  | { what: 'shipment'; op: 'update'; shipmentId: string; before: Row }
  | { what: 'return'; returnIds: string[] }
  | { what: 'cancel'; before: Row };

type Applied = { ok: true; change: LifecycleChange | null } | { ok: false; error: string };

/** Move one shipment on from what a later email says, keeping what it leaves out. */
async function updateShipment(
  supabase: SupabaseClient,
  existing: Row & { id: string },
  extraction: LifecycleExtraction,
  extra: Row = {},
): Promise<Applied> {
  const nextStatus = existing.status === 'delivered' ? 'delivered' : extraction.shipmentStatus;
  const { data, error } = await supabase
    .from('shipments')
    .update({
      ...extra,
      status: nextStatus,
      carrier: extraction.carrier ?? existing.carrier,
      tracking_url: extraction.trackingUrl ?? existing.tracking_url,
      expected_on: extraction.expectedOn ?? existing.expected_on,
      shipped_at: extraction.shippedAt ?? existing.shipped_at,
      delivered_at:
        nextStatus === 'delivered'
          ? (extraction.deliveredAt ?? existing.delivered_at ?? extraction.shippedAt)
          : existing.delivered_at,
    })
    .eq('id', existing.id)
    .select('id');
  if (error) return { ok: false, error: error.message };
  const changed = (data ?? []).length > 0;
  return {
    ok: true,
    change: changed ? { what: 'shipment', op: 'update', shipmentId: existing.id, before: { ...existing } } : null,
  };
}

async function insertShipment(
  supabase: SupabaseClient,
  orderId: string,
  extraction: LifecycleExtraction,
  tracking: string | null,
): Promise<Applied> {
  const { data, error } = await supabase
    .from('shipments')
    .insert({
      order_id: orderId,
      carrier: extraction.carrier,
      tracking_number: tracking,
      tracking_url: extraction.trackingUrl,
      status: extraction.shipmentStatus,
      shipped_at: extraction.shippedAt,
      delivered_at: extraction.shipmentStatus === 'delivered' ? extraction.deliveredAt : null,
      expected_on: extraction.expectedOn,
    })
    .select('id');
  if (error) return { ok: false, error: error.message };
  const id = (data as { id: string }[] | null)?.[0]?.id;
  return { ok: true, change: id ? { what: 'shipment', op: 'insert', shipmentId: id } : null };
}

async function upsertShipment(
  supabase: SupabaseClient,
  opts: {
    orderId: string;
    extraction: LifecycleExtraction;
  },
): Promise<Applied> {
  const { orderId, extraction } = opts;
  const tracking = extraction.trackingNumber;

  // Whole rows, so a change can be recorded with what the shipment held before.
  if (tracking) {
    const { data: existing } = await supabase
      .from('shipments')
      .select('*')
      .eq('order_id', orderId)
      .eq('tracking_number', tracking)
      .maybeSingle();

    if (existing) return updateShipment(supabase, existing, extraction);

    // A shipment an earlier email opened without a number is this one: the
    // number arrived later. Filling it in keeps the order to one parcel.
    const { data: unnumbered } = await supabase
      .from('shipments')
      .select('*')
      .eq('order_id', orderId)
      .is('tracking_number', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (unnumbered) {
      return updateShipment(supabase, unnumbered, extraction, { tracking_number: tracking });
    }

    return insertShipment(supabase, orderId, extraction, tracking);
  }

  // No tracking number — update the latest open shipment, or create one.
  const { data: open } = await supabase
    .from('shipments')
    .select('*')
    .eq('order_id', orderId)
    .neq('status', 'delivered')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (open) return updateShipment(supabase, open, extraction);

  if (extraction.shipmentStatus === 'delivered') {
    const { data: anyShipment } = await supabase
      .from('shipments')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (anyShipment) return updateShipment(supabase, anyShipment, extraction);
  }

  return insertShipment(supabase, orderId, extraction, null);
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
): Promise<Applied> {
  const { data: already } = await supabase
    .from('returns')
    .select('id')
    .eq('source_message_id', opts.sourceMessageId)
    .limit(1)
    .maybeSingle();
  if (already) return { ok: true, change: null };

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

  const { data: inserted, error } = await supabase.from('returns').insert(rows).select('id');
  if (error) return { ok: false, error: error.message };
  const returnIds = ((inserted ?? []) as { id: string }[]).map((row) => row.id);
  return { ok: true, change: returnIds.length > 0 ? { what: 'return', returnIds } : null };
}

/**
 * Apply a classified lifecycle email onto an existing order.
 * Never writes orders.status directly — shipments / returns / cancelled_at
 * drive sync_order_state via triggers. What it wrote comes back as
 * `change`, which the mail sync records for Home (recordLifecycleChange in
 * lib/orders/record.ts).
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
): Promise<Applied> {
  const timezone = opts.timezone ?? 'UTC';

  if (opts.classification === 'cancellation') {
    if (opts.order.cancelledAt) return { ok: true, change: null };
    const { data: before } = await supabase
      .from('orders')
      .select('*')
      .eq('id', opts.order.id)
      .eq('user_id', opts.userId)
      .maybeSingle();
    const { data, error } = await supabase
      .from('orders')
      .update({
        cancelled_at: (opts.receivedAt ?? new Date()).toISOString(),
      })
      .eq('id', opts.order.id)
      .eq('user_id', opts.userId)
      .is('cancelled_at', null)
      .select('id');
    if (error) return { ok: false, error: error.message };
    const changed = (data ?? []).length > 0 && before;
    return { ok: true, change: changed ? { what: 'cancel', before: { ...before } } : null };
  }

  if (opts.classification === 'shipping' || opts.classification === 'delivery') {
    return upsertShipment(supabase, {
      orderId: opts.order.id,
      extraction: opts.extraction,
    });
  }

  if (opts.classification === 'return') {
    return applyReturnFromEmail(supabase, {
      userId: opts.userId,
      orderId: opts.order.id,
      extraction: opts.extraction,
      sourceMessageId: opts.sourceMessageId,
      timezone,
    });
  }

  return { ok: false, error: `Unsupported classification ${opts.classification}` };
}
