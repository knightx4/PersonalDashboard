import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient, requireUser } from '@/lib/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { buttonVariants } from '@/components/ui/button';
import { gmailOpenUrl } from '@/lib/email/gmail-open';
import { formatMoney, lineSubtotalCents } from '@/lib/money';
import {
  ConfirmOrderButton,
  DiscardOrderButton,
} from '@/app/(app)/review/review-buttons';
import { ExcludeMerchantButton } from './exclude-merchant-button';
import { DeleteOrderButton } from './delete-order-button';
import { restoreDeletedOrder } from '@/app/(app)/orders/actions';
import { Button } from '@/components/ui/button';

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
        inventory_items ( id, cost_cents, status )
      )
    `,
    )
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!order) notFound();

  const isDeleted = Boolean(order.deleted_at);

  const { data: sourceMessages } = await supabase
    .from('ingested_messages')
    .select(
      'provider_message_id, thread_id, subject, from_address, classification, parse_status, received_at, email_accounts ( email_address )',
    )
    .eq('resulting_order_id', id)
    .order('received_at', { ascending: true });

  const confirmationMessage =
    sourceMessages?.find((row) => row.classification === 'order_confirmation') ?? null;
  /** Prefer confirmation for header actions; otherwise the earliest linked mail. */
  const primaryMessage = confirmationMessage ?? sourceMessages?.[0] ?? null;
  const lifecycleMessages = (sourceMessages ?? []).filter(
    (row) =>
      row.classification === 'shipping' ||
      row.classification === 'delivery' ||
      row.classification === 'return' ||
      row.classification === 'cancellation',
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
  const inbox = Array.isArray(primaryMessage?.email_accounts)
    ? primaryMessage?.email_accounts[0]
    : primaryMessage?.email_accounts;
  const gmailHref = gmailOpenUrl({
    emailAddress: inbox?.email_address,
    threadId: primaryMessage?.thread_id,
    messageId: primaryMessage?.provider_message_id,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <PageHeader
        title={merchant?.name ?? primaryMessage?.subject?.slice(0, 48) ?? 'Order'}
        description={`${order.order_date}${
          order.external_order_number ? ` · #${order.external_order_number}` : ''
        } · ${order.status.replaceAll('_', ' ')}${
          order.needs_review ? ' · needs review' : ''
        }${isDeleted ? ' · deleted' : ''}`}
        actions={
          <div className="flex flex-wrap gap-2">
            {gmailHref && (
              <a
                href={gmailHref}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                Open in Gmail
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
                <Link href="/review" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
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
            <Link href="/orders" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              All orders
            </Link>
          </div>
        }
      />

      {isDeleted && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          This order is in Deleted orders. Its inventory is hidden from your owned list until you
          restore it. Manage it in{' '}
          <Link href="/settings#deleted-orders" className="underline underline-offset-2">
            Settings
          </Link>
          .
        </p>
      )}

      {!isDeleted && order.needs_review && (
        <div className="flex flex-col gap-3 rounded-card border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-amber-950">Needs review</p>
            <p className="text-[13px] text-amber-900/80">
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

      {(confirmationMessage || lifecycleMessages.length > 0) && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint">
            Emails
          </h2>

          {confirmationMessage && (
            <OrderEmailCard
              message={confirmationMessage}
              emphasis="primary"
              label="Order confirmation"
            />
          )}

          {lifecycleMessages.length > 0 && (
            <ul className="divide-y divide-border overflow-hidden rounded-card border border-border/80 bg-canvas/60">
              {lifecycleMessages.map((message) => (
                <li key={`${message.provider_message_id}-${message.classification}`}>
                  <OrderEmailCard message={message} emphasis="secondary" />
                </li>
              ))}
            </ul>
          )}

          {inbox?.email_address && (
            <p className="text-[12px] text-ink-faint">Via {inbox.email_address}</p>
          )}
        </section>
      )}

      {(shipments?.length ?? 0) > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint">
            Shipments
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {(shipments ?? []).map((shipment) => (
              <li key={shipment.id} className="px-4 py-3 text-sm">
                <p className="font-medium text-ink">
                  {shipment.status.replaceAll('_', ' ')}
                  {shipment.carrier ? ` · ${shipment.carrier}` : ''}
                </p>
                <p className="mt-1 text-[13px] text-ink-muted">
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
                {shipment.tracking_url && (
                  <p className="mt-1.5">
                    <a
                      href={shipment.tracking_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[13px] text-brand hover:underline"
                    >
                      Track package
                    </a>
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(returnRows?.length ?? 0) > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-faint">
            Returns
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {(returnRows ?? []).map((row) => (
              <li key={row.id} className="flex justify-between gap-4 px-4 py-3 text-sm">
                <span className="text-ink">
                  {row.status.replaceAll('_', ' ')}
                  {row.refunded_at ? ` · ${row.refunded_at}` : ` · ${row.initiated_at}`}
                </span>
                <span className="tabular text-ink-muted">
                  {formatMoney(row.refund_amount_cents, order.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="overflow-hidden rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[12px] uppercase tracking-wider text-ink-faint">
            <tr>
              <th className="px-4 py-2 font-semibold">Item</th>
              <th className="px-4 py-2 font-semibold">Qty</th>
              <th className="px-4 py-2 text-right font-semibold">Unit</th>
              <th className="px-4 py-2 text-right font-semibold">Line</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => {
              const category = Array.isArray(item.categories)
                ? item.categories[0]
                : item.categories;
              const units = item.inventory_items ?? [];
              return (
                <tr key={item.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-ink">{item.name}</p>
                    <p className="text-[13px] text-ink-muted">
                      {[item.variant, category?.name].filter(Boolean).join(' · ') || '—'}
                    </p>
                    {item.product_url && (
                      <p className="mt-1.5">
                        <a
                          href={item.product_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[13px] text-brand hover:underline"
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
                              href={`/inventory/${unit.id}`}
                              className="text-[13px] font-medium text-brand hover:underline"
                            >
                              View in inventory
                              {units.length > 1 ? ` (${index + 1} of ${units.length})` : ''}
                            </Link>
                            <span className="tabular text-[13px] text-ink-muted">
                              Landed {formatMoney(unit.cost_cents, order.currency)}
                            </span>
                            <span className="rounded-md bg-canvas px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                              {unit.status.replaceAll('_', ' ')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="tabular px-4 py-3 align-top text-ink-muted">{item.quantity}</td>
                  <td className="tabular px-4 py-3 align-top text-right text-ink">
                    {formatMoney(item.unit_price_cents, order.currency)}
                  </td>
                  <td className="tabular px-4 py-3 align-top text-right text-ink">
                    {formatMoney(
                      lineSubtotalCents(item.quantity, item.unit_price_cents),
                      order.currency,
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <dl className="grid gap-2 rounded-card border border-border bg-surface px-4 py-3 text-sm sm:grid-cols-2">
        <div className="flex justify-between gap-4 sm:col-span-2">
          <dt className="text-ink-muted">Subtotal</dt>
          <dd className="tabular text-ink">{formatMoney(order.subtotal_cents, order.currency)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Tax</dt>
          <dd className="tabular text-ink">{formatMoney(order.tax_cents, order.currency)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Shipping</dt>
          <dd className="tabular text-ink">{formatMoney(order.shipping_cents, order.currency)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-muted">Discount</dt>
          <dd className="tabular text-ink">
            {formatMoney(order.discount_cents, order.currency)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-border pt-2 sm:col-span-2">
          <dt className="font-medium text-ink">Total</dt>
          <dd className="tabular font-semibold text-ink">
            {formatMoney(order.total_cents, order.currency)}
          </dd>
        </div>
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
            {inbox?.email_address ? (
              <span className="mt-0.5 block text-[13px] font-normal text-ink-faint">
                {inbox.email_address}
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
  email_accounts:
    | { email_address: string }
    | { email_address: string }[]
    | null;
};

const CLASSIFICATION_LABELS: Record<string, string> = {
  order_confirmation: 'Order confirmation',
  shipping: 'Shipped',
  delivery: 'Delivered',
  return: 'Return',
  cancellation: 'Cancelled',
};

function OrderEmailCard({
  message,
  emphasis,
  label,
}: {
  message: LinkedEmail;
  emphasis: 'primary' | 'secondary';
  label?: string;
}) {
  const account = Array.isArray(message.email_accounts)
    ? message.email_accounts[0]
    : message.email_accounts;
  const href = gmailOpenUrl({
    emailAddress: account?.email_address,
    threadId: message.thread_id,
    messageId: message.provider_message_id,
  });
  const kind =
    label ??
    CLASSIFICATION_LABELS[message.classification ?? ''] ??
    (message.classification?.replaceAll('_', ' ') || 'Email');
  const received = message.received_at
    ? new Date(message.received_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  if (emphasis === 'primary') {
    return (
      <div className="rounded-card border border-border bg-surface px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              {kind}
            </p>
            <p className="mt-1 truncate text-sm font-medium text-ink">
              {message.subject ?? 'No subject'}
            </p>
            <p className="mt-0.5 truncate text-[13px] text-ink-muted">
              {[message.from_address, received].filter(Boolean).join(' · ')}
            </p>
          </div>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              Open in Gmail
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{kind}</p>
        <p className="mt-0.5 truncate text-[13px] text-ink-muted">
          {message.subject ?? 'No subject'}
        </p>
        <p className="truncate text-[12px] text-ink-faint">
          {[message.from_address, received].filter(Boolean).join(' · ')}
        </p>
      </div>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[12px] text-ink-faint hover:text-brand hover:underline"
        >
          Open
        </a>
      )}
    </div>
  );
}
