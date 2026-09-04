import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { gmailOpenUrl } from '@/lib/email/gmail-open';
import { convertToDisplayCents, loadDisplayCurrency } from '@/lib/fx/display';
import { normalizeCurrencyCode } from '@/lib/fx/money-fx';
import { formatMoney, lineSubtotalCents } from '@/lib/money';
import {
  ConfirmOrderButton,
  DiscardOrderButton,
} from '@/app/shopping/review/review-buttons';
import { ExcludeMerchantButton } from './exclude-merchant-button';
import { DeleteOrderButton } from './delete-order-button';
import { OrderItemTags } from '../order-item-tags';
import { restoreDeletedOrder } from '@/app/shopping/orders/actions';
import { Button } from '@/components/ui/button';
import { orderItemTags } from '@/lib/orders/search';

export const metadata = { title: 'Order' };

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
      'provider_message_id, thread_id, subject, from_address, classification, received_at, email_address',
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
    .select('id, status, refund_amount_cents, initiated_at, refunded_at')
    .eq('order_id', id)
    .order('initiated_at', { ascending: false });

  const merchant = Array.isArray(order.merchants) ? order.merchants[0] : order.merchants;
  const items = order.order_items ?? [];
  const inboxAddress = orderEmailMessage?.email_address ?? null;
  const orderEmailHref = messageGmailHref(orderEmailMessage);

  // Pair lifecycle emails to shipment rows (nearest by date, each email used once).
  const shipmentEmailLinks = pairShipmentEmails(shipments ?? [], shippingMessages, deliveryMessages);

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
  }));

  function moneyLabel(displayCents: number, nativeCents: number): string {
    const primary = formatMoney(displayCents, displayCurrency);
    if (!showNative) return primary;
    return `${primary} · ${formatMoney(nativeCents, nativeCurrency)}`;
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title={merchant?.name ?? orderEmailMessage?.subject?.slice(0, 48) ?? 'Order'}
        description={`${order.order_date}${
          order.external_order_number ? ` · #${order.external_order_number}` : ''
        } · ${order.status.replaceAll('_', ' ')}${
          order.needs_review ? ' · needs review' : ''
        }${isDeleted ? ' · deleted' : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {orderEmailHref && (
              <a
                href={orderEmailHref}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                Open order email
              </a>
            )}
            {!isDeleted && (
              <>
                <ExcludeMerchantButton
                  orderId={order.id}
                  merchantName={merchant?.name ?? 'this sender'}
                />
                <DeleteOrderButton
                  orderId={order.id}
                  merchantName={merchant?.name ?? 'this order'}
                />
                <Link href="/shopping/review" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
                  Review queue
                </Link>
              </>
            )}
            {isDeleted && (
              <form action={restoreDeletedOrder}>
                <input type="hidden" name="orderId" value={order.id} />
                <Button type="submit" size="sm">
                  Restore order
                </Button>
              </form>
            )}
            <Link href="/shopping/orders" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              All orders
            </Link>
          </div>
        }
      />

      {isDeleted && (
        <p className="rounded-lg border border-border bg-caution-tint px-3 py-2 text-body text-caution">
          This order is in Deleted orders. Its inventory is hidden from your owned list until you
          restore it. Manage it in{' '}
          <Link href="/shopping/settings#deleted-orders" className="underline underline-offset-2">
            Settings
          </Link>
          .
        </p>
      )}

      {!isDeleted && order.needs_review && (
        <div className="flex flex-col gap-3 rounded-card border border-border bg-caution-tint px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-body font-medium text-caution">Needs review</p>
            <p className="text-ui text-caution/80">
              Imported with the fallback parser. Confirm the totals and items, or discard if this
              should not count toward spend.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ConfirmOrderButton orderId={order.id} />
            <DiscardOrderButton orderId={order.id} />
          </div>
        </div>
      )}

      {(shipments?.length ?? 0) > 0 && (
        <section className="space-y-3">
          <h2 className="text-body font-semibold uppercase tracking-wider text-ink-muted">
            Shipments
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {(shipments ?? []).map((shipment) => {
              const links = shipmentEmailLinks.get(shipment.id) ?? {};
              return (
                <li key={shipment.id} className="px-4 py-3 text-body">
                  <p className="font-medium text-ink">
                    {shipment.status.replaceAll('_', ' ')}
                    {shipment.carrier ? ` · ${shipment.carrier}` : ''}
                  </p>
                  <p className="mt-1 text-ui text-ink-muted">
                    {[
                      shipment.tracking_number ? `Tracking ${shipment.tracking_number}` : null,
                      shipment.shipped_at
                        ? `Shipped ${new Date(shipment.shipped_at).toLocaleDateString()}`
                        : null,
                      shipment.delivered_at
                        ? `Delivered ${new Date(shipment.delivered_at).toLocaleDateString()}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No tracking details yet'}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {shipment.tracking_url && (
                      <a
                        href={shipment.tracking_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ui text-accent hover:underline"
                      >
                        Track package
                      </a>
                    )}
                    {links.shippingHref && (
                      <a
                        href={links.shippingHref}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ui text-ink-muted hover:text-accent hover:underline"
                      >
                        Open shipping email
                      </a>
                    )}
                    {links.deliveryHref && (
                      <a
                        href={links.deliveryHref}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ui text-ink-muted hover:text-accent hover:underline"
                      >
                        Open delivery email
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {(returnRows?.length ?? 0) > 0 && (
        <section className="space-y-3">
          <h2 className="text-body font-semibold uppercase tracking-wider text-ink-muted">
            Returns
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {(displayReturns ?? []).map((row) => (
              <li key={row.id} className="flex justify-between gap-4 px-4 py-3 text-body">
                <span className="text-ink">
                  {row.status.replaceAll('_', ' ')}
                  {row.refunded_at ? ` · ${row.refunded_at}` : ` · ${row.initiated_at}`}
                </span>
                <span className="tabular text-ink-muted">
                  {moneyLabel(row.display_refund_cents, row.refund_amount_cents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="overflow-hidden rounded-card border border-border bg-surface">
        <table className="w-full text-body">
          <thead className="border-b border-border text-left text-small uppercase tracking-wider text-ink-muted">
            <tr>
              <th className="px-4 py-2 font-semibold">Item</th>
              <th className="px-4 py-2 font-semibold">Qty</th>
              <th className="px-4 py-2 text-right font-semibold">Unit</th>
              <th className="px-4 py-2 text-right font-semibold">Line</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {displayItems.map((item) => {
              const category = Array.isArray(item.categories)
                ? item.categories[0]
                : item.categories;
              const units = item.display_units;
              return (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{item.name}</p>
                    <p className="text-ui text-ink-muted">
                      {[item.variant, category?.name].filter(Boolean).join(' · ') || '—'}
                    </p>
                    <OrderItemTags
                      orderId={order.id}
                      orderItemId={item.id}
                      tags={orderItemTags(item).map((tag) => ({
                        id: tag.id ?? '',
                        name: tag.name,
                      })).filter((tag) => tag.id)}
                      readOnly={isDeleted}
                    />
                    {item.product_url && (
                      <p className="mt-1.5">
                        <a
                          href={item.product_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-ui text-accent hover:underline"
                        >
                          View product
                        </a>
                      </p>
                    )}
                    {units.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {units.map((unit, index) => (
                          <li
                            key={unit.id}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1"
                          >
                            <Link
                              href={`/shopping/inventory/${unit.id}`}
                              className="text-ui font-medium text-accent hover:underline"
                            >
                              View in inventory
                              {units.length > 1 ? ` (${index + 1} of ${units.length})` : ''}
                            </Link>
                            <span className="tabular text-ui text-ink-muted">
                              Landed {moneyLabel(unit.display_cost_cents, unit.cost_cents)}
                            </span>
                            <span className="rounded-md bg-canvas px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-ink-muted">
                              {unit.status.replaceAll('_', ' ')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="tabular px-4 py-3 align-top text-ink-muted">{item.quantity}</td>
                  <td className="tabular px-4 py-3 align-top text-right text-ink">
                    {moneyLabel(item.display_unit_cents, item.unit_price_cents)}
                  </td>
                  <td className="tabular px-4 py-3 align-top text-right text-ink">
                    {moneyLabel(
                      item.display_line_cents,
                      lineSubtotalCents(item.quantity, item.unit_price_cents),
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <dl className="grid gap-2 rounded-card border border-border bg-surface px-4 py-3 text-body sm:grid-cols-2">
        <div className="flex justify-between gap-4 sm:col-span-2">
          <dt className="text-ink-muted">Subtotal</dt>
          <dd className="tabular text-ink">
            {moneyLabel(displaySubtotal, order.subtotal_cents)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Tax</dt>
          <dd className="tabular text-ink">{moneyLabel(displayTax, order.tax_cents)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Shipping</dt>
          <dd className="tabular text-ink">
            {moneyLabel(displayShipping, order.shipping_cents)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Discount</dt>
          <dd className="tabular text-ink">
            {moneyLabel(displayDiscount, order.discount_cents)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-border pt-2 sm:col-span-2">
          <dt className="font-medium text-ink">Total</dt>
          <dd className="tabular font-semibold text-ink">
            {moneyLabel(displayTotal, order.total_cents)}
          </dd>
        </div>
        {showNative && (
          <div className="flex justify-between gap-4 sm:col-span-2">
            <dt className="text-ink-muted">Order currency</dt>
            <dd className="text-ink">{nativeCurrency}</dd>
          </div>
        )}
        {order.return_deadline && (
          <div className="flex justify-between gap-4 sm:col-span-2">
            <dt className="text-ink-muted">Return deadline</dt>
            <dd className="text-ink">{order.return_deadline}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4 sm:col-span-2">
          <dt className="text-ink-muted">Source</dt>
          <dd className="text-right text-ink">
            {order.source.replaceAll('_', ' ')}
            {inboxAddress ? (
              <span className="mt-0.5 block text-ui font-normal text-ink-muted">
                {inboxAddress}
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
    </div>
  );
}

type LinkedEmail = {
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
      const leftover = shippingMessages.find((message) => !usedShipping.has(message.provider_message_id));
      const href = messageGmailHref(leftover ?? null);
      if (href) links.shippingHref = href;
    }
    if (!links.deliveryHref && (only.status === 'delivered' || only.delivered_at)) {
      const leftover = deliveryMessages.find((message) => !usedDelivery.has(message.provider_message_id));
      const href = messageGmailHref(leftover ?? null);
      if (href) links.deliveryHref = href;
    }
    result.set(only.id, links);
  }

  return result;
}
