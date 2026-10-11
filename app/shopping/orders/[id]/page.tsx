import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { gmailOpenUrl } from '@/lib/email/gmail-open';
import { convertToDisplayCents, loadDisplayCurrency } from '@/lib/fx/display';
import { normalizeCurrencyCode } from '@/lib/fx/money-fx';
import { formatMoney, lineSubtotalCents } from '@/lib/money';
import { orderItemTags } from '@/lib/orders/search';
import type { DevComment } from '@/lib/comments/load';
import { loadThread } from '@/lib/thread/store';
import { threadRef } from '@/lib/thread/subjects';
import { OrderDetailView } from './order-detail-view';

export const metadata = { title: 'Order' };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const supabase = await createClient();
  const { id } = await params;

  const { data: order } = await supabase
    .from('orders')
    .select(
      `
      id, order_date, status, source, external_order_number, return_deadline, needs_review,
      subtotal_cents, tax_cents, shipping_cents, discount_cents, total_cents, currency,
      deleted_at,
      merchants ( id, name ),
      order_items (
        id, name, variant, quantity, unit_price_cents, category_id, product_url, image_url,
        categories ( name ),
        inventory_items ( id, cost_cents, status ),
        order_item_tags ( id, tag_id, item_tags ( id, name, slug ) )
      )
    `,
    )
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!order) notFound();

  const isDeleted = Boolean(order.deleted_at);

  const { data: sourceMessages } = await supabase
    .from('inbox_messages')
    .select(
      'id, provider_message_id, thread_id, subject, from_address, classification, received_at, email_address',
    )
    .eq('resulting_order_id', id)
    .order('received_at', { ascending: true });

  const confirmationMessage =
    sourceMessages?.find((row) => row.classification === 'order_confirmation') ?? null;
  const orderEmailMessage = confirmationMessage ?? sourceMessages?.[0] ?? null;
  const shippingMessages = (sourceMessages ?? []).filter(
    (row) => row.classification === 'shipping',
  );
  const deliveryMessages = (sourceMessages ?? []).filter(
    (row) => row.classification === 'delivery',
  );

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, carrier, tracking_number, tracking_url, status, shipped_at, delivered_at')
    .eq('order_id', id)
    .order('created_at', { ascending: true });

  const { data: returnRows } = await supabase
    .from('returns')
    .select('id, status, refund_amount_cents, initiated_at, refunded_at, source_message_id')
    .eq('order_id', id)
    .order('initiated_at', { ascending: false });

  // A failed read leaves the thread empty rather than the page broken.
  const thread = await loadThread(supabase, threadRef('order', order.id), { userId: user.id }).catch(
    (): DevComment[] => [],
  );

  const merchant = Array.isArray(order.merchants) ? order.merchants[0] : order.merchants;
  const items = order.order_items ?? [];
  const inboxAddress = orderEmailMessage?.email_address ?? null;
  const orderEmailHref = messageGmailHref(orderEmailMessage);

  // Pair lifecycle emails to shipment rows (nearest by date, each email used once).
  const shipmentEmailLinks = pairShipmentEmails(
    shipments ?? [],
    shippingMessages,
    deliveryMessages,
  );

  const displayCurrency = await loadDisplayCurrency(supabase, user.id);
  const nativeCurrency = order.currency;
  const showNative =
    normalizeCurrencyCode(nativeCurrency) !== normalizeCurrencyCode(displayCurrency);

  const moneySpecs: Array<{ cents: number; currency: string; date: string }> = [
    { cents: order.subtotal_cents, currency: nativeCurrency, date: order.order_date },
    { cents: order.tax_cents, currency: nativeCurrency, date: order.order_date },
    { cents: order.shipping_cents, currency: nativeCurrency, date: order.order_date },
    { cents: order.discount_cents, currency: nativeCurrency, date: order.order_date },
    { cents: order.total_cents, currency: nativeCurrency, date: order.order_date },
  ];
  for (const item of items) {
    moneySpecs.push({
      cents: item.unit_price_cents,
      currency: nativeCurrency,
      date: order.order_date,
    });
    moneySpecs.push({
      cents: lineSubtotalCents(item.quantity, item.unit_price_cents),
      currency: nativeCurrency,
      date: order.order_date,
    });
    for (const unit of item.inventory_items ?? []) {
      moneySpecs.push({
        cents: unit.cost_cents,
        currency: nativeCurrency,
        date: order.order_date,
      });
    }
  }
  for (const row of returnRows ?? []) {
    moneySpecs.push({
      cents: row.refund_amount_cents,
      currency: nativeCurrency,
      date: (row.refunded_at ?? row.initiated_at ?? order.order_date).slice(0, 10),
    });
  }

  const converted = await convertToDisplayCents(supabase, moneySpecs, displayCurrency);
  let cursor = 0;
  const next = () => converted[cursor++] ?? 0;
  const displaySubtotal = next();
  const displayTax = next();
  const displayShipping = next();
  const displayDiscount = next();
  const displayTotal = next();
  const displayItems = items.map((item) => {
    const unit = next();
    const line = next();
    const units = (item.inventory_items ?? []).map((inv) => ({
      ...inv,
      display_cost_cents: next(),
    }));
    return { ...item, display_unit_cents: unit, display_line_cents: line, display_units: units };
  });
  const displayReturns = (returnRows ?? []).map((row) => ({
    ...row,
    display_refund_cents: next(),
    // The return email that recorded it, when it came from one.
    emailHref: messageGmailHref(
      (sourceMessages ?? []).find((message) => message.id === row.source_message_id),
    ),
  }));

  function moneyLabel(displayCents: number, nativeCents: number): string {
    const primary = formatMoney(displayCents, displayCurrency);
    if (!showNative) return primary;
    return `${primary} · ${formatMoney(nativeCents, nativeCurrency)}`;
  }

  return (
    <OrderDetailView
      order={{
        id: order.id,
        title: merchant?.name ?? orderEmailMessage?.subject?.slice(0, 48) ?? 'Order',
        merchantName: merchant?.name ?? null,
        order_date: order.order_date,
        status: order.status,
        source: order.source,
        external_order_number: order.external_order_number,
        return_deadline: order.return_deadline,
        needs_review: order.needs_review,
        deleted: isDeleted,
        nativeCurrency: showNative ? nativeCurrency : null,
        inboxAddress,
        emailHref: orderEmailHref,
      }}
      totals={{
        subtotal: moneyLabel(displaySubtotal, order.subtotal_cents),
        tax: moneyLabel(displayTax, order.tax_cents),
        shipping: moneyLabel(displayShipping, order.shipping_cents),
        discount: moneyLabel(displayDiscount, order.discount_cents),
        total: moneyLabel(displayTotal, order.total_cents),
      }}
      shipments={(shipments ?? []).map((shipment) => ({
        ...shipment,
        links: shipmentEmailLinks.get(shipment.id) ?? {},
      }))}
      returns={displayReturns.map((row) => ({
        id: row.id,
        status: row.status,
        initiated_at: row.initiated_at,
        refunded_at: row.refunded_at,
        refundLabel: moneyLabel(row.display_refund_cents, row.refund_amount_cents),
        emailHref: row.emailHref,
      }))}
      emails={(sourceMessages ?? []).map((message) => ({
        id: message.id,
        subject: message.subject,
        classification: message.classification,
        received_at: message.received_at,
        href: messageGmailHref(message),
      }))}
      items={displayItems.map((item) => {
        const category = Array.isArray(item.categories) ? item.categories[0] : item.categories;
        return {
          id: item.id,
          name: item.name,
          variant: item.variant,
          quantity: item.quantity,
          categoryName: category?.name ?? null,
          product_url: item.product_url,
          tags: orderItemTags(item)
            .map((tag) => ({ id: tag.id ?? '', name: tag.name }))
            .filter((tag) => tag.id),
          unitLabel: moneyLabel(item.display_unit_cents, item.unit_price_cents),
          lineLabel: moneyLabel(
            item.display_line_cents,
            lineSubtotalCents(item.quantity, item.unit_price_cents),
          ),
          units: item.display_units.map((unit) => ({
            id: unit.id,
            status: unit.status,
            costLabel: moneyLabel(unit.display_cost_cents, unit.cost_cents),
          })),
        };
      })}
      thread={thread}
    />
  );
}

type LinkedEmail = {
  id?: string;
  provider_message_id: string;
  thread_id: string | null;
  subject: string | null;
  from_address: string | null;
  classification: string | null;
  received_at: string | null;
  email_address: string | null;
};

type ShipmentRow = {
  id: string;
  status: string;
  shipped_at: string | null;
  delivered_at: string | null;
};

function messageGmailHref(message: LinkedEmail | null | undefined): string | null {
  if (!message) return null;
  // The view carries the mailbox address, so this no longer needs an embed
  // that PostgREST could not resolve across schemas anyway.
  return gmailOpenUrl({
    emailAddress: message.email_address ?? undefined,
    threadId: message.thread_id,
    messageId: message.provider_message_id,
  });
}

function messageTimeMs(message: LinkedEmail): number {
  if (!message.received_at) return Number.POSITIVE_INFINITY;
  return new Date(message.received_at).getTime();
}

function takeNearestMessage(
  messages: LinkedEmail[],
  used: Set<string>,
  targetMs: number | null,
): LinkedEmail | null {
  const available = messages.filter((message) => !used.has(message.provider_message_id));
  if (available.length === 0) return null;
  if (targetMs == null || !Number.isFinite(targetMs)) {
    return available[0] ?? null;
  }
  let best: LinkedEmail | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const message of available) {
    const delta = Math.abs(messageTimeMs(message) - targetMs);
    if (delta < bestDelta) {
      best = message;
      bestDelta = delta;
    }
  }
  return best;
}

function pairShipmentEmails(
  shipments: ShipmentRow[],
  shippingMessages: LinkedEmail[],
  deliveryMessages: LinkedEmail[],
): Map<string, { shippingHref?: string; deliveryHref?: string }> {
  const usedShipping = new Set<string>();
  const usedDelivery = new Set<string>();
  const result = new Map<string, { shippingHref?: string; deliveryHref?: string }>();

  for (const shipment of shipments) {
    const shippedMs = shipment.shipped_at ? new Date(shipment.shipped_at).getTime() : null;
    const deliveredMs = shipment.delivered_at ? new Date(shipment.delivered_at).getTime() : null;
    const links: { shippingHref?: string; deliveryHref?: string } = {};

    const shipping = takeNearestMessage(shippingMessages, usedShipping, shippedMs);
    if (shipping) {
      usedShipping.add(shipping.provider_message_id);
      const href = messageGmailHref(shipping);
      if (href) links.shippingHref = href;
    }

    const isDelivered = shipment.status === 'delivered' || Boolean(shipment.delivered_at);
    if (isDelivered) {
      const delivery = takeNearestMessage(deliveryMessages, usedDelivery, deliveredMs ?? shippedMs);
      if (delivery) {
        usedDelivery.add(delivery.provider_message_id);
        const href = messageGmailHref(delivery);
        if (href) links.deliveryHref = href;
      }
    }

    result.set(shipment.id, links);
  }

  // If a single shipment has no shipping email but unused ones remain, attach the first.
  if (shipments.length === 1) {
    const only = shipments[0]!;
    const links = result.get(only.id) ?? {};
    if (!links.shippingHref) {
      const leftover = shippingMessages.find(
        (message) => !usedShipping.has(message.provider_message_id),
      );
      const href = messageGmailHref(leftover ?? null);
      if (href) links.shippingHref = href;
    }
    if (!links.deliveryHref && (only.status === 'delivered' || only.delivered_at)) {
      const leftover = deliveryMessages.find(
        (message) => !usedDelivery.has(message.provider_message_id),
      );
      const href = messageGmailHref(leftover ?? null);
      if (href) links.deliveryHref = href;
    }
    result.set(only.id, links);
  }

  return result;
}
