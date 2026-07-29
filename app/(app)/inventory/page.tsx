import { Package } from 'lucide-react';
import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { loadUserMerchants, parseMerchantId } from '@/lib/merchants/user-merchants';
import { formatMoney, periodFor, type PresetRange } from '@/lib/money';

export const metadata = { title: 'Inventory' };

const RANGES: { id: PresetRange | 'all'; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_3_months', label: 'Last 3 months' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'last_12_months', label: 'Last 12 months' },
];

function inventoryHref(opts: {
  q?: string;
  category?: string;
  merchant?: string;
  range?: string;
}): string {
  const params = new URLSearchParams();
  if (opts.range && opts.range !== 'all') params.set('range', opts.range);
  if (opts.q) params.set('q', opts.q);
  if (opts.category) params.set('category', opts.category);
  if (opts.merchant) params.set('merchant', opts.merchant);
  const qs = params.toString();
  return qs ? `/inventory?${qs}` : '/inventory';
}

function merchantNameFromItem(item: {
  order_items:
    | {
        orders:
          | { merchants: { name: string } | { name: string }[] | null }
          | { merchants: { name: string } | { name: string }[] | null }[]
          | null;
      }
    | {
        orders:
          | { merchants: { name: string } | { name: string }[] | null }
          | { merchants: { name: string } | { name: string }[] | null }[]
          | null;
      }[]
    | null;
}): string | null {
  const orderItem = Array.isArray(item.order_items) ? item.order_items[0] : item.order_items;
  const order = orderItem
    ? Array.isArray(orderItem.orders)
      ? orderItem.orders[0]
      : orderItem.orders
    : null;
  const merchant = order
    ? Array.isArray(order.merchants)
      ? order.merchants[0]
      : order.merchants
    : null;
  return merchant?.name ?? null;
}

/** Everything currently owned: inventory_items where status is 'owned'. */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    category?: string;
    merchant?: string;
    range?: string;
  }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  // Strip PostgREST filter metacharacters so a typed comma cannot widen the OR.
  const q = (params.q ?? '').trim().replace(/[%_,*()]/g, ' ').replace(/\s+/g, ' ').trim();
  const categoryId = params.category?.trim() || undefined;
  const merchantId = parseMerchantId(params.merchant);
  const range =
    RANGES.find((entry) => entry.id === params.range)?.id ?? 'all';

  const [{ data: categories }, merchants, { data: profile }] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, color')
      .is('parent_id', null)
      .order('name'),
    loadUserMerchants(supabase, user.id),
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
  ]);

  const timezone = profile?.timezone ?? 'UTC';
  const activeMerchant =
    merchantId && merchants.some((entry) => entry.id === merchantId)
      ? merchantId
      : undefined;
  const period = range === 'all' ? null : periodFor(range, timezone);

  const selectWithOptionalInner = activeMerchant
    ? `
        id, name, variant, cost_cents, acquired_at, status, category_id,
        categories(name, color),
        order_items!inner (
          orders!inner (
            merchant_id,
            merchants ( name )
          )
        )
      `
    : `
        id, name, variant, cost_cents, acquired_at, status, category_id,
        categories(name, color),
        order_items (
          orders (
            merchant_id,
            merchants ( name )
          )
        )
      `;

  let query = supabase
    .from('inventory_items')
    .select(selectWithOptionalInner)
    .eq('user_id', user.id)
    .eq('status', 'owned')
    .order('acquired_at', { ascending: false });

  if (categoryId) query = query.eq('category_id', categoryId);
  if (activeMerchant) {
    query = query.eq('order_items.orders.merchant_id', activeMerchant);
  }
  if (period) {
    query = query.gte('acquired_at', period.start).lte('acquired_at', period.end);
  }
  if (q) query = query.or(`name.ilike.%${q}%,variant.ilike.%${q}%`);

  const { data: items, error } = await query;
  if (error) throw error;

  const filtered = Boolean(q || categoryId || activeMerchant || range !== 'all');

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <LeftRail>
        <RailGroup label="Acquired">
          {RANGES.map((entry) => (
            <RailItem
              key={entry.id}
              label={entry.label}
              active={entry.id === range}
              href={inventoryHref({
                range: entry.id,
                q: q || undefined,
                category: categoryId,
                merchant: activeMerchant,
              })}
            />
          ))}
        </RailGroup>
        <RailGroup label="Merchant">
          <RailItem
            label="Any"
            active={!activeMerchant}
            href={inventoryHref({
              range,
              q: q || undefined,
              category: categoryId,
            })}
          />
          {merchants.map((merchant) => (
            <RailItem
              key={merchant.id}
              label={merchant.name}
              active={merchant.id === activeMerchant}
              href={inventoryHref({
                range,
                q: q || undefined,
                category: categoryId,
                merchant: merchant.id,
              })}
            />
          ))}
        </RailGroup>
        <RailGroup label="Category">
          <RailItem
            label="All"
            active={!categoryId}
            href={inventoryHref({
              range,
              q: q || undefined,
              merchant: activeMerchant,
            })}
          />
          {(categories ?? []).map((category) => (
            <RailItem
              key={category.id}
              label={category.name}
              swatch={category.color ?? undefined}
              active={category.id === categoryId}
              href={inventoryHref({
                range,
                q: q || undefined,
                category: category.id,
                merchant: activeMerchant,
              })}
            />
          ))}
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Inventory"
          description="Everything you currently own, so you can check before buying it again."
        />

        <form className="mb-5" action="/inventory" method="get">
          {range !== 'all' && <input type="hidden" name="range" value={range} />}
          {categoryId && <input type="hidden" name="category" value={categoryId} />}
          {activeMerchant && (
            <input type="hidden" name="merchant" value={activeMerchant} />
          )}
          <Input
            name="q"
            defaultValue={q}
            placeholder="Search what you own…"
            aria-label="Search inventory"
          />
        </form>

        {(items ?? []).length === 0 ? (
          <EmptyState
            icon={Package}
            title={filtered ? 'No matching items' : 'Nothing in your inventory yet'}
            description={
              filtered
                ? 'Try a different search, merchant, category, or date range.'
                : 'Every item from an order lands here as its own entry, so you can search what you own, mark things returned, or record that you got rid of them.'
            }
            action={
              filtered
                ? { label: 'Clear filters', href: '/inventory' }
                : { label: 'Add an order', href: '/orders/new' }
            }
            secondaryAction={
              filtered ? undefined : { label: 'Connect an inbox', href: '/settings' }
            }
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {items!.map((item) => {
              const category = Array.isArray(item.categories)
                ? item.categories[0]
                : item.categories;
              const merchantName = merchantNameFromItem(item);
              return (
                <li key={item.id}>
                  <Link
                    href={`/inventory/${item.id}`}
                    className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-canvas"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: category?.color ?? '#cfcfc8' }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-ink">{item.name}</p>
                      <p className="truncate text-[13px] text-ink-muted">
                        {[merchantName, item.variant, category?.name, item.acquired_at]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <p className="tabular shrink-0 font-medium text-ink">
                      {formatMoney(item.cost_cents)}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
