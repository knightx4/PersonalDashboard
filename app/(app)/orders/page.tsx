import { Receipt } from 'lucide-react';
import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { formatMoney, periodFor, type PresetRange } from '@/lib/money';
import {
  matchingItemHint,
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

function hrefFor(opts: { range: PresetRange; status?: string; q?: string }): string {
  const params = new URLSearchParams({ range: opts.range });
  if (opts.status) params.set('status', opts.status);
  if (opts.q) params.set('q', opts.q);
  return `/orders?${params.toString()}`;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; status?: string; q?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const range =
    RANGES.find((entry) => entry.id === params.range)?.id ?? 'last_12_months';
  const status = STATUSES.find((entry) => entry.id === params.status)?.id;
  const q = sanitizeOrdersQuery(params.q);

  const { data: profile } = await supabase
    .from('profiles')
    .select('timezone')
    .eq('id', user.id)
    .single();
  const timezone = profile?.timezone ?? 'UTC';
  const period = periodFor(range, timezone);

  let query = supabase
    .from('orders')
    .select(
      `
      id, order_date, total_cents, currency, status, external_order_number,
      merchants ( name ),
      order_items ( name, variant ),
      ingested_messages ( subject, from_address )
    `,
    )
    .eq('user_id', user.id)
    .gte('order_date', period.start)
    .lte('order_date', period.end)
    .order('order_date', { ascending: false });

  if (status) query = query.eq('status', status);

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

  const filteredEmpty = orders.length === 0 && Boolean(q || status);

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <LeftRail>
        <RailGroup label="Time range">
          {RANGES.map((entry) => (
            <RailItem
              key={entry.id}
              label={entry.label}
              active={entry.id === range}
              href={hrefFor({ range: entry.id, status, q: q || undefined })}
            />
          ))}
        </RailGroup>
        <RailGroup label="Status">
          <RailItem
            label="Any"
            active={!status}
            href={hrefFor({ range, q: q || undefined })}
          />
          {STATUSES.map((entry) => (
            <RailItem
              key={entry.id}
              label={entry.label}
              active={entry.id === status}
              href={hrefFor({ range, status: entry.id, q: q || undefined })}
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
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search merchant, item, order #, email subject…"
            aria-label="Search orders"
          />
        </form>

        {orders.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={filteredEmpty ? 'No matching orders' : 'No orders yet'}
            description={
              filteredEmpty
                ? 'Try a different search, status, or time range.'
                : 'Orders appear here as we find them in your inbox, grouped by month. You can also add one by hand at any time.'
            }
            action={
              filteredEmpty
                ? { label: 'Clear filters', href: hrefFor({ range: 'last_12_months' }) }
                : { label: 'Add an order', href: '/orders/new' }
            }
            secondaryAction={
              filteredEmpty ? undefined : { label: 'Connect an inbox', href: '/settings' }
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
                    const itemHint = q ? matchingItemHint(order, q) : null;
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
                            <p className="truncate text-[13px] text-ink-muted">
                              {order.order_date}
                              {order.external_order_number
                                ? ` · #${order.external_order_number}`
                                : ''}
                              {` · ${order.status.replaceAll('_', ' ')}`}
                              {itemHint ? ` · ${itemHint}` : ''}
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
