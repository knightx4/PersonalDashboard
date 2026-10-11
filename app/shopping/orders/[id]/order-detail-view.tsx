import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { DetailLayout, Property, PropertyList } from '@/components/shell/detail-layout';
import { Banner } from '@/components/ui/banner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { ConfirmOrderButton, DiscardOrderButton } from '@/app/shopping/review/review-buttons';
import { restoreDeletedOrder } from '@/app/shopping/orders/actions';
import { GmailAnchor } from '@/components/ui/gmail-anchor';
import { Thread } from '@/components/thread/thread';
import type { DevComment } from '@/lib/comments/load';
import { threadRef } from '@/lib/thread/subjects';
import { ExcludeMerchantButton } from './exclude-merchant-button';
import { DeleteOrderButton } from './delete-order-button';
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
 * it from fixtures (plan #1604).
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
    <div className="[&_a]:press-area max-sm:[&_input]:min-h-11">
      <DetailLayout
        header={
          <>
            <PageHeader
              title={order.title}
              description={`${order.order_date}${
                order.external_order_number ? ` · #${order.external_order_number}` : ''
              } · ${order.status.replaceAll('_', ' ')}${
                order.needs_review ? ' · needs review' : ''
              }${order.deleted ? ' · deleted' : ''}`}
              actions={
                <div className="flex min-w-0 max-w-full flex-wrap gap-2 [&>*]:min-w-0 [&>*]:max-w-full max-sm:[&_button]:justify-start max-sm:[&_button]:whitespace-normal max-sm:[&_button]:text-left">
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
                  {!order.deleted && (
                    <>
                      <ExcludeMerchantButton
                        orderId={order.id}
                        merchantName={order.merchantName ?? 'this sender'}
                      />
                      <DeleteOrderButton
                        orderId={order.id}
                        merchantName={order.merchantName ?? 'this order'}
                      />
                      <Link
                        href="/shopping/review"
                        className={buttonVariants({ variant: 'ghost', size: 'sm' })}
                      >
                        Review queue
                      </Link>
                    </>
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
                </div>
              }
            />

            {order.deleted && (
              <Banner tone="warn">
                This order is in Deleted orders. Its inventory is hidden from your owned list until
                you restore it. Manage it in{' '}
                <Link
                  href="/shopping/settings#deleted-orders"
                  className="underline underline-offset-2"
                >
                  Settings
                </Link>
                .
              </Banner>
            )}

            {!order.deleted && order.needs_review && (
              <Banner tone="warn">
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
        properties={
          <PropertyList>
            <Property label="Ordered" value={order.order_date} />
            <Property label="Total" value={totals.total} />
            <Property label="Status" value={order.status.replaceAll('_', ' ')} />
            {order.nativeCurrency && (
              <Property label="Order currency" value={order.nativeCurrency} />
            )}
            {order.return_deadline && (
              <Property label="Return deadline" value={order.return_deadline} />
            )}
            <Property label="Source" value={order.source.replaceAll('_', ' ')} />
            {order.inboxAddress && <Property label="Inbox" value={order.inboxAddress} />}
          </PropertyList>
        }
      >
        <div className="space-y-6">
          {shipments.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
                Shipments
              </h2>
              <ul
                className={cn(
                  cardVariants({ padding: 'none' }),
                  'divide-y divide-border overflow-hidden',
                )}
              >
                {shipments.map((shipment) => {
                  const links = shipment.links;
                  return (
                    <li key={shipment.id} className="row-pad px-4 text-body">
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
                            className="text-ui text-ink-muted transition-colors duration-quick hover:text-accent hover:underline"
                          >
                            Open shipping email
                          </a>
                        )}
                        {links.deliveryHref && (
                          <a
                            href={links.deliveryHref}
                            target="_blank"
                            rel="noreferrer"
                            className="text-ui text-ink-muted transition-colors duration-quick hover:text-accent hover:underline"
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

          {returns.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
                Returns
              </h2>
              <ul
                className={cn(
                  cardVariants({ padding: 'none' }),
                  'divide-y divide-border overflow-hidden',
                )}
              >
                {returns.map((row) => (
                  <li key={row.id} className="row-pad flex justify-between gap-4 px-4 text-body">
                    <span className="text-ink">
                      {row.status.replaceAll('_', ' ')}
                      {row.refunded_at ? ` · ${row.refunded_at}` : ` · ${row.initiated_at}`}
                      {row.emailHref && (
                        <a
                          href={row.emailHref}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-3 text-ui text-ink-muted transition-colors duration-quick hover:text-accent hover:underline"
                        >
                          Open return email
                        </a>
                      )}
                    </span>
                    <span className="tabular text-ink-muted">{row.refundLabel}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Every email linked to the order, including one attached from the
            review queue that wrote nothing onto it (a pickup notice, a support
            thread), which no other section would show. */}
          {emails.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">
                Emails
              </h2>
              <ul
                className={cn(
                  cardVariants({ padding: 'none' }),
                  'divide-y divide-border overflow-hidden',
                )}
              >
                {emails.map((message) => {
                  const href = message.href;
                  return (
                    <li key={message.id} className="row-pad flex justify-between gap-4 px-4">
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
                          className="shrink-0 text-ui text-ink-muted transition-colors duration-quick hover:text-accent hover:underline"
                        >
                          Open in Gmail
                        </GmailAnchor>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <Card padding="none" className="overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>Item</TH>
                  <TH num>Qty</TH>
                  <TH num>Unit</TH>
                  <TH num>Line</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((item) => {
                  const units = item.units;
                  return (
                    <TR key={item.id}>
                      {/* The primary cell is set medium; everything under the
                        name steps back to the normal weight. */}
                      <TD primary className="text-body">
                        {/* One block: stacked on a phone, the cell lays its children side by side. */}
                        <div className="min-w-0 flex-1 text-left">
                          <p className="text-ink">{item.name}</p>
                          <p className="text-ui font-normal text-ink-muted">
                            {[item.variant, item.categoryName].filter(Boolean).join(' · ') || '—'}
                          </p>
                          <div className="font-normal">
                            <OrderItemTags
                              orderId={order.id}
                              orderItemId={item.id}
                              tags={item.tags}
                              readOnly={order.deleted}
                            />
                          </div>
                          {item.product_url && (
                            <p className="mt-1.5">
                              <a
                                href={item.product_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-ui font-medium text-accent hover:underline"
                              >
                                View product
                              </a>
                            </p>
                          )}
                          {units.length > 0 && (
                            <ul className="mt-2 space-y-1.5 font-normal">
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
                                    Landed {unit.costLabel}
                                  </span>
                                  <span className="rounded-md bg-canvas px-1.5 py-0.5 text-micro font-semibold uppercase tracking-wide text-ink-muted">
                                    {unit.status.replaceAll('_', ' ')}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </TD>
                      <TD num muted label="Qty" className="text-body">
                        {item.quantity}
                      </TD>
                      <TD num label="Unit" className="text-body">
                        {item.unitLabel}
                      </TD>
                      <TD num label="Line" className="text-body">
                        {item.lineLabel}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </Card>

          <dl
            className={cn(
              cardVariants({ padding: 'dense' }),
              'grid gap-2 text-body sm:grid-cols-2',
            )}
          >
            <div className="flex justify-between gap-4 sm:col-span-2">
              <dt className="text-ink-muted">Subtotal</dt>
              <dd className="tabular text-ink">{totals.subtotal}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Tax</dt>
              <dd className="tabular text-ink">{totals.tax}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Shipping</dt>
              <dd className="tabular text-ink">{totals.shipping}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-ink-muted">Discount</dt>
              <dd className="tabular text-ink">{totals.discount}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-border pt-2 sm:col-span-2">
              <dt className="font-medium text-ink">Total</dt>
              <dd className="tabular font-semibold text-ink">{totals.total}</dd>
            </div>
          </dl>

          {/* Notes on the order; one tagged @dash is answered here, from the order (plan #1471). */}
          <section aria-label="Comments" className="px-1">
            <Thread
              subject={threadRef('order', order.id)}
              turns={thread}
              placeholder="A note on this order, or a question for Dash."
            />
          </section>
        </div>
      </DetailLayout>
    </div>
  );
}
