import { Receipt } from 'lucide-react';
import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { formatMoney, periodFor, type PresetRange } from '@/lib/money';

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

function hrefFor(range: PresetRange, status?: string): string {
  const params = new URLSearchParams({ range });
  if (status) params.set('status', status);
  return `/orders?${params.toString()}`;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; status?: string }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const range =
    RANGES.find((entry) => entry.id === params.range)?.id ?? 'last_12_months';
  const status = STATUSES.find((entry) => entry.id === params.status)?.id;

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
      'id, order_date, total_cents, currency, status, external_order_number, merchants(name)',
    )
    .eq('user_id', user.id)
    .gte('order_date', period.start)
    .lte('order_date', period.end)
    .order('order_date', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data: orders, error } = await query;
  if (error) throw error;

  const grouped = new Map<string, NonNullable<typeof orders>>();
  for (const order of orders ?? []) {
    const key = monthKey(order.order_date);
    const bucket = grouped.get(key) ?? [];
    bucket.push(order);
    grouped.set(key, bucket);
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <LeftRail>
        <RailGroup label="Time range">
          {RANGES.map((entry) => (
            <RailItem
              key={entry.id}
              label={entry.label}
              active={entry.id === range}
              href={hrefFor(entry.id, status)}
            />
          ))}
        </RailGroup>
        <RailGroup label="Status">
          <RailItem label="Any" active={!status} href={hrefFor(range)} />
          {STATUSES.map((entry) => (
            <RailItem
              key={entry.id}
              label={entry.label}
              active={entry.id === status}
              href={hrefFor(range, entry.id)}
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

        {(orders ?? []).length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="No orders yet"
            description="Orders appear here as we find them in your inbox, grouped by month. You can also add one by hand at any time."
            action={{ label: 'Add an order', href: '/orders/new' }}
            secondaryAction={{ label: 'Connect an inbox', href: '/settings' }}
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
