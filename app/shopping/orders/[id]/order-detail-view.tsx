import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { Property } from '@/components/shell/detail-layout';
import { DetailFacts, DetailPage } from '@/components/patterns/list-detail';
import { Banner } from '@/components/ui/banner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { ConfirmOrderButton, DiscardOrderButton } from '@/app/shopping/review/review-buttons';
import { restoreDeletedOrder } from '@/app/shopping/orders/actions';
import { GmailAnchor } from '@/components/ui/gmail-anchor';
import { Thread } from '@/components/thread/thread';
import type { DevComment } from '@/lib/comments/load';
import { threadRef } from '@/lib/thread/subjects';
import { OrderActionsMenu } from './order-actions-menu';
import { OrderItemTags } from '../order-item-tags';

/**
 * One order as the page shows it. Every amount is already a label in the
 * display currency, with the order's own currency after it when they differ
 * (page.tsx converts them), so the view draws and does not convert.
 */
export type OrderDetail = {
  order: {
    id: string;
    title: string;
    merchantName: string | null;
    order_date: string;
    status: string;
    source: string;
    external_order_number: string | null;
    return_deadline: string | null;
    needs_review: boolean;
    deleted: boolean;
    /** Set only when it differs from the display currency. */
    nativeCurrency: string | null;
    inboxAddress: string | null;
    emailHref: string | null;
  };
  totals: { subtotal: string; tax: string; shipping: string; discount: string; total: string };
  shipments: {
    id: string;
    status: string;
    carrier: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
    shipped_at: string | null;
    delivered_at: string | null;
    links: { shippingHref?: string; deliveryHref?: string };
  }[];
  returns: {
    id: string;
    status: string;
    initiated_at: string | null;
    refunded_at: string | null;
    refundLabel: string;
    emailHref: string | null;
  }[];
  emails: {
    id: string;
    subject: string | null;
    classification: string | null;
    received_at: string | null;
    href: string | null;
  }[];
  items: {
    id: string;
    name: string;
    variant: string | null;
    quantity: number;
    categoryName: string | null;
    product_url: string | null;
    tags: { id: string; name: string }[];
    unitLabel: string;
    lineLabel: string;
    units: { id: string; status: string; costLabel: string }[];
  }[];
  thread: DevComment[];
};

/**
 * One order, drawn from what the page read (page.tsx), so the gallery can draw
 * it from fixtures (plan #1604). The list-and-detail pattern's item page, one
 * column at every width (plan #1782): the header and its one line of actions,
 * the facts as a grid, then shipments, returns, emails, items, totals and the
 * comments.
 */
export function OrderDetailView({
  order,
  totals,
  shipments,
  returns,
  emails,
  items,
  thread,
}: OrderDetail) {
  return (
    <DetailPage
      className="[&_a]:press-area max-sm:[&_input]:min-h-11"
      header={
        <>
          <PageHeader
            title={order.title}
            description={`${order.order_date}${
              order.external_order_number ? ` · #${order.external_order_number}` : ''
            } · ${order.status.replaceAll('_', ' ')}${
              order.needs_review ? ' · needs review' : ''
            }${order.deleted ? ' · deleted' : ''}`}
          />

          {/* One line, left-aligned at every width: the two everyday moves as
              buttons, the rest behind the menu. */}
          <div className="-mt-2 mb-5 flex flex-wrap items-center gap-2">
            {order.emailHref && (
              <a
                href={order.emailHref}
                target="_blank"
                rel="noreferrer"
                className={buttonVariants({ variant: 'secondary', size: 'sm' })}
              >
                Open order email
              </a>
            )}
            {order.deleted && (
              <form action={restoreDeletedOrder}>
                <input type="hidden" name="orderId" value={order.id} />
                <Button type="submit" size="sm">
                  Restore order
                </Button>
              </form>
            )}
            <Link
              href="/shopping/orders"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              All orders
            </Link>
            {!order.deleted && (
              <OrderActionsMenu orderId={order.id} merchantName={order.merchantName} />
            )}
          </div>

          {order.deleted && (
            <Banner tone="warn" className="mb-5">
              This order is in Deleted orders. Its inventory is hidden from your owned list until
              you restore it. Manage it in{' '}
              <Link href="/shopping/settings#deleted-orders" className="underline underline-offset-2">
                Settings
              </Link>
              .
            </Banner>
          )}

          {!order.deleted && order.needs_review && (
            <Banner tone="warn" className="mb-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">Needs review</p>
                  <p className="text-ui text-ink-muted">
                    Imported with the fallback parser. Confirm the totals and items, or discard if
                    this should not count toward spend.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <ConfirmOrderButton orderId={order.id} />
                  <DiscardOrderButton orderId={order.id} />
                </div>
              </div>
            </Banner>
          )}
        </>
      }
      details={
        <DetailFacts>
          <Property label="Ordered" value={order.order_date} />
          <Property label="Total" value={totals.total} />
          <Property label="Status" value={order.status.replaceAll('_', ' ')} />
          <Property label="Source" value={order.source.replaceAll('_', ' ')} />
          {order.nativeCurrency && <Property label="Order currency" value={order.nativeCurrency} />}
          {order.return_deadline && (
            <Property label="Return deadline" value={order.return_deadline} />
          )}
          {order.inboxAddress && <Property label="Inbox" value={order.inboxAddress} wide />}
        </DetailFacts>
      }
    >
      {shipments.length > 0 && (
        <OrderSection title="Shipments">
          {shipments.map((shipment) => {
            const links = shipment.links;
            return (
              <li key={shipment.id} className="row-pad card-pad-x text-body">
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
                {(shipment.tracking_url || links.shippingHref || links.deliveryHref) && (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    {shipment.tracking_url && (
                      <a
                        href={shipment.tracking_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ui font-medium text-accent hover:underline"
                      >
                        Track package
                      </a>
                    )}
                    {links.shippingHref && (
                      <a
                        href={links.shippingHref}
                        target="_blank"
                        rel="noreferrer"
                        className={QUIET_LINK}
                      >
                        Open shipping email
                      </a>
                    )}
                    {links.deliveryHref && (
                      <a
                        href={links.deliveryHref}
                        target="_blank"
                        rel="noreferrer"
                        className={QUIET_LINK}
                      >
                        Open delivery email
                      </a>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </OrderSection>
      )}

      {returns.length > 0 && (
        <OrderSection title="Returns">
          {returns.map((row) => (
            <li key={row.id} className="row-pad card-pad-x text-body">
              <div className="flex items-baseline justify-between gap-4">
                <span className="min-w-0 text-ink">
                  {row.status.replaceAll('_', ' ')}
                  {row.refunded_at
                    ? ` · ${row.refunded_at}`
                    : row.initiated_at
                      ? ` · ${row.initiated_at}`
                      : ''}
                </span>
                <span className="tabular shrink-0 whitespace-nowrap text-ink">
                  {row.refundLabel}
                </span>
              </div>
              {row.emailHref && (
                <a
                  href={row.emailHref}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(QUIET_LINK, 'mt-1 inline-block')}
                >
                  Open return email
                </a>
              )}
            </li>
          ))}
        </OrderSection>
      )}

      {/* Every email linked to the order, including one attached from the
        review queue that wrote nothing onto it (a pickup notice, a support
        thread), which no other section would show. */}
      {emails.length > 0 && (
        <OrderSection title="Emails">
          {emails.map((message) => {
            const href = message.href;
            return (
              <li key={message.id} className="row-pad card-pad-x flex justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-body text-ink">
                    {message.subject?.trim() || 'Email without subject'}
                  </p>
                  <p className="text-ui text-ink-muted">
                    {[
                      message.classification?.replaceAll('_', ' '),
                      message.received_at
                        ? new Date(message.received_at).toLocaleDateString()
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                {href && (
                  <GmailAnchor
                    href={href}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(QUIET_LINK, 'shrink-0')}
                  >
                    Open in Gmail
                  </GmailAnchor>
                )}
              </li>
            );
          })}
        </OrderSection>
      )}

      <OrderSection title="Items">
        {items.map((item) => {
          const units = item.units;
          const sub = [item.variant, item.categoryName].filter(Boolean).join(' · ');
          return (
            <li key={item.id} className="row-pad card-pad-x text-body">
              <p className="font-medium text-ink [overflow-wrap:anywhere]">{item.name}</p>
              {sub && <p className="text-ui text-ink-muted">{sub}</p>}
              {/* One line of figures: what each cost on the left, the line on the right. */}
              <div className="mt-1 flex items-baseline justify-between gap-4">
                <span className="tabular min-w-0 text-ui text-ink-muted">
                  {item.quantity} × {item.unitLabel}
                </span>
                <span className="tabular shrink-0 whitespace-nowrap text-ink">
                  {item.lineLabel}
                </span>
              </div>
              <OrderItemTags
                orderId={order.id}
                orderItemId={item.id}
                tags={item.tags}
                readOnly={order.deleted}
              />
              {(item.product_url || units.length > 0) && (
                <ul className="mt-2 space-y-1.5">
                  {item.product_url && (
                    <li>
                      <a
                        href={item.product_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ui font-medium text-accent hover:underline"
                      >
                        View product
                      </a>
                    </li>
                  )}
                  {units.map((unit, index) => (
                    <li key={unit.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Link
                        href={`/shopping/inventory/${unit.id}`}
                        className="text-ui font-medium text-accent hover:underline"
                      >
                        View in inventory
                        {units.length > 1 ? ` (${index + 1} of ${units.length})` : ''}
                      </Link>
                      <span className="tabular text-ui text-ink-muted">
                        Landed {unit.costLabel}
                      </span>
                      <span className="rounded-md bg-canvas px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-ink-muted">
                        {unit.status.replaceAll('_', ' ')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </OrderSection>

      {/* One label per line on the left, every value on the right edge. */}
      <Card padding="dense">
        <dl className="space-y-2 text-body">
          {(
            [
              ['Subtotal', totals.subtotal],
              ['Tax', totals.tax],
              ['Shipping', totals.shipping],
              ['Discount', totals.discount],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="tabular text-right text-ink">{value}</dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2">
            <dt className="font-medium text-ink">Total</dt>
            <dd className="tabular text-right font-semibold text-ink">{totals.total}</dd>
          </div>
        </dl>
      </Card>

      {/* Notes on the order; one tagged @dash is answered here, from the
        order (plan #1471). On a card of its own, so it has the same ground
        as the panels above it in dark too. */}
      <Card padding="dense" aria-label="Comments" role="region">
        <Thread
          subject={threadRef('order', order.id)}
          turns={thread}
          placeholder="A note on this order, or a question for Dash."
          onCard
        />
      </Card>
    </DetailPage>
  );
}

const QUIET_LINK =
  'text-ui text-ink-muted transition-colors duration-quick hover:text-accent hover:underline';

/** A titled section of rows on one card. */
function OrderSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">{title}</h2>
      <ul className={cn(cardVariants({ padding: 'none' }), 'divide-y divide-border overflow-hidden')}>
        {children}
      </ul>
    </section>
  );
}
