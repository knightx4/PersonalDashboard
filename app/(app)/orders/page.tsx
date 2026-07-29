import { Receipt } from 'lucide-react';
import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { loadUserMerchants, parseMerchantId } from '@/lib/merchants/user-merchants';
import { formatMoney, periodFor, type PresetRange } from '@/lib/money';
import {
  matchingItemHint,
  orderInboxAddress,
  orderItemsSummary,
  orderMatchesQuery,
  sanitizeOrdersQuery,
} from '@/lib/orders/search';

export const metadata = { title: 'Orders' };

const RANGES: { id: PresetRange; label: string }[] = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_3_months', label: 'Last 3 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'last_12_months', label: 'Last 12 months' },
];

const STATUSES = [
  { id: 'ordered', label: 'Ordered' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'partially_returned', label: 'Partially returned' },
  { id: 'returned', label: 'Returned' },
  { id: 'cancelled', label: 'Cancelled' },
] as const;

function monthKey(orderDate: string): string {
  return orderDate.slice(0, 7);
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

function monthLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function hrefFor(opts: {
  range: PresetRange;
  status?: string;
  merchant?: string;
  q?: string;
}): string {
  const params = new URLSearchParams({ range: opts.range });
  if (opts.status) params.set('status', opts.status);
  if (opts.merchant) params.set('merchant', opts.merchant);
  if (opts.q) params.set('q', opts.q);
  return `/orders?${params.toString()}`;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    status?: string;
    merchant?: string;
    q?: string;
  }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const range =
    RANGES.find((entry) => entry.id === params.range)?.id ?? 'last_12_months';
  const status = STATUSES.find((entry) => entry.id === params.status)?.id;
  const merchantId = parseMerchantId(params.merchant);
  const q = sanitizeOrdersQuery(params.q);

  const [{ data: profile }, merchants, { count: inboxCount }] = await Promise.all([
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
    loadUserMerchants(supabase, user.id),
    supabase
      .from('email_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id),
  ]);
  const timezone = profile?.timezone ?? 'UTC';
  const period = periodFor(range, timezone);
  const activeMerchant =
    merchantId && merchants.some((entry) => entry.id === merchantId)
      ? merchantId
      : undefined;
  const showInbox = (inboxCount ?? 0) > 1;

  let query = supabase
    .from('orders')
    .select(
      `
      id, order_date, total_cents, currency, status, external_order_number,
      merchants ( name ),
      order_items ( name, variant, quantity, categories ( name ) ),
      ingested_messages ( subject, from_address, classification, email_accounts ( email_address ) )
    `,
    )
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .gte('order_date', period.start)
    .lte('order_date', period.end)
    .order('order_date', { ascending: false });

  if (status) query = query.eq('status', status);
  if (activeMerchant) query = query.eq('merchant_id', activeMerchant);

  const { data: rows, error } = await query;
  if (error) throw error;

  const orders = q ? (rows ?? []).filter((order) => orderMatchesQuery(order, q)) : (rows ?? []);

  const grouped = new Map<string, typeof orders>();
  for (const order of orders) {
    const key = monthKey(order.order_date);
    const bucket = grouped.get(key) ?? [];
    bucket.push(order);
    grouped.set(key, bucket);
  }

  const filteredEmpty = orders.length === 0 && Boolean(q || status || activeMerchant);

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <LeftRail>
        <RailGroup label="Time range">
          {RANGES.map((entry) => (
            <RailItem
              key={entry.id}
              label={entry.label}
              active={entry.id === range}
              href={hrefFor({
                range: entry.id,
                status,
                merchant: activeMerchant,
                q: q || undefined,
              })}
            />
          ))}
        </RailGroup>
        <RailGroup label="Merchant">
          <RailItem
            label="Any"
            active={!activeMerchant}
            href={hrefFor({ range, status, q: q || undefined })}
          />
          {merchants.map((merchant) => (
            <RailItem
              key={merchant.id}
              label={merchant.name}
              active={merchant.id === activeMerchant}
              href={hrefFor({
                range,
                status,
                merchant: merchant.id,
                q: q || undefined,
              })}
            />
          ))}
        </RailGroup>
        <RailGroup label="Status">
          <RailItem
            label="Any"
            active={!status}
            href={hrefFor({ range, merchant: activeMerchant, q: q || undefined })}
          />
          {STATUSES.map((entry) => (
            <RailItem
              key={entry.id}
              label={entry.label}
              active={entry.id === status}
              href={hrefFor({
                range,
                status: entry.id,
                merchant: activeMerchant,
                q: q || undefined,
              })}
            />
          ))}
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Orders"
          description="Everything you have bought, newest first."
          actions={
            <Link href="/orders/new" className={buttonVariants({ size: 'sm' })}>
              Add an order
            </Link>
          }
        />

        <form className="mb-5" action="/orders" method="get">
          <input type="hidden" name="range" value={range} />
          {status && <input type="hidden" name="status" value={status} />}
          {activeMerchant && (
            <input type="hidden" name="merchant" value={activeMerchant} />
          )}
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search merchant, item, order #, inbox…"
            aria-label="Search orders"
          />
        </form>

        {orders.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={filteredEmpty ? 'No matching orders' : 'No orders yet'}
            description={
              filteredEmpty
                ? 'Try a different search, merchant, status, or time range.'
                : 'Orders appear here as we find them in your inboxes, grouped by month. You can also add one by hand at any time.'
            }
            action={
              filteredEmpty
                ? { label: 'Clear filters', href: hrefFor({ range: 'last_12_months' }) }
                : { label: 'Add an order', href: '/orders/new' }
            }
            secondaryAction={
              filteredEmpty ? undefined : { label: 'Connect an inbox', href: '/settings#inboxes' }
            }
          />
        ) : (
          <div className="space-y-8">
            {[...grouped.entries()].map(([key, monthOrders]) => (
              <section key={key}>
                <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                  {monthLabel(key)}
                </h2>
                <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
                  {monthOrders.map((order) => {
                    const merchant = Array.isArray(order.merchants)
                      ? order.merchants[0]
                      : order.merchants;
                    const itemsSummary = orderItemsSummary(order);
                    const itemHint = q ? matchingItemHint(order, q) : null;
                    const inbox = showInbox ? orderInboxAddress(order) : null;
                    return (
                      <li key={order.id}>
                        <Link
                          href={`/orders/${order.id}`}
                          className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-canvas"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-ink">
                              {merchant?.name ?? 'Unknown merchant'}
                            </p>
                            <p className="truncate text-[13px] text-ink">
                              {itemsSummary.label}
                              {itemHint && !itemsSummary.label.includes(itemHint)
                                ? ` · ${itemHint}`
                                : ''}
                            </p>
                            <p className="truncate text-[13px] text-ink-muted">
                              {order.order_date}
                              {order.external_order_number
                                ? ` · #${order.external_order_number}`
                                : ''}
                              {` · ${order.status.replaceAll('_', ' ')}`}
                              {inbox ? ` · ${inbox}` : ''}
                            </p>
                          </div>
                          <p className="tabular shrink-0 font-medium text-ink">
                            {formatMoney(order.total_cents, order.currency)}
                          </p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
