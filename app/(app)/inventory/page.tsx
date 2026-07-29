import { ArrowUpDown, Layers, Package, Search, SearchX } from 'lucide-react';
import { createClient, requireUser } from '@/lib/auth/server';
import { InventoryRow, type InventoryRowItem } from '@/components/inventory/inventory-row';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Select } from '@/components/ui/field';
import { backfillUserInventoryDisplay } from '@/lib/inventory/backfill-display';
import { filterAndRankBySearch } from '@/lib/inventory/search';
import {
  GROUP_OPTIONS,
  groupInventoryItems,
  parseGroupId,
  parseSortId,
  SORT_OPTIONS,
  sortInventoryItems,
} from '@/lib/inventory/sort-group';
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseListId(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value || !UUID_RE.test(value)) return undefined;
  return value;
}

function inventoryHref(opts: {
  q?: string;
  category?: string;
  merchant?: string;
  list?: string;
  range?: string;
  sort?: string;
  group?: string;
}): string {
  const params = new URLSearchParams();
  if (opts.range && opts.range !== 'all') params.set('range', opts.range);
  if (opts.q) params.set('q', opts.q);
  if (opts.category) params.set('category', opts.category);
  if (opts.merchant) params.set('merchant', opts.merchant);
  if (opts.list) params.set('list', opts.list);
  if (opts.sort && opts.sort !== 'newest') params.set('sort', opts.sort);
  if (opts.group && opts.group !== 'none') params.set('group', opts.group);
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
    list?: string;
    range?: string;
    sort?: string;
    group?: string;
  }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;
  const q = (params.q ?? '').trim().replace(/[%_,*()]/g, ' ').replace(/\s+/g, ' ').trim();
  const categoryId = params.category?.trim() || undefined;
  const merchantId = parseMerchantId(params.merchant);
  const listId = parseListId(params.list);
  const range =
    RANGES.find((entry) => entry.id === params.range)?.id ?? 'all';
  const sort = parseSortId(params.sort);
  const group = parseGroupId(params.group);

  await backfillUserInventoryDisplay(supabase, user.id);

  const [{ data: categories }, { data: lists }, merchants, { data: profile }] = await Promise.all([
    supabase
      .from('categories')
      .select('id, name, color, slug')
      .is('parent_id', null)
      .order('name'),
    supabase
      .from('item_lists')
      .select('id, name, color')
      .eq('user_id', user.id)
      .order('name'),
    loadUserMerchants(supabase, user.id),
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
  ]);

  const timezone = profile?.timezone ?? 'UTC';
  const activeMerchant =
    merchantId && merchants.some((entry) => entry.id === merchantId)
      ? merchantId
      : undefined;
  const activeList =
    listId && (lists ?? []).some((entry) => entry.id === listId) ? listId : undefined;
  const period = range === 'all' ? null : periodFor(range, timezone);

  const membershipJoin = activeList
    ? `inventory_item_lists!inner ( list_id )`
    : `inventory_item_lists ( list_id )`;

  const selectWithOptionalInner = activeMerchant
    ? `
        id, name, short_name, variant, cost_cents, acquired_at, status, category_id,
        image_url, return_planned, search_tags,
        categories(name, color, slug),
        ${membershipJoin},
        order_items!inner (
          image_url,
          orders!inner (
            merchant_id,
            merchants ( name )
          )
        )
      `
    : `
        id, name, short_name, variant, cost_cents, acquired_at, status, category_id,
        image_url, return_planned, search_tags,
        categories(name, color, slug),
        ${membershipJoin},
        order_items (
          image_url,
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
  if (activeList) {
    query = query.eq('inventory_item_lists.list_id', activeList);
  }
  if (period) {
    query = query.gte('acquired_at', period.start).lte('acquired_at', period.end);
  }

  const { data: rows, error } = await query;
  if (error) throw error;

  type InventoryRow = {
    id: string;
    name: string;
    short_name: string | null;
    variant: string | null;
    cost_cents: number;
    acquired_at: string | null;
    status: string;
    category_id: string | null;
    image_url: string | null;
    return_planned: boolean;
    search_tags: string[] | null;
    categories:
      | { name: string; color: string | null; slug: string }
      | { name: string; color: string | null; slug: string }[]
      | null;
    order_items:
      | {
          image_url: string | null;
          orders:
            | { merchants: { name: string } | { name: string }[] | null }
            | { merchants: { name: string } | { name: string }[] | null }[]
            | null;
        }
      | {
          image_url: string | null;
          orders:
            | { merchants: { name: string } | { name: string }[] | null }
            | { merchants: { name: string } | { name: string }[] | null }[]
            | null;
        }[]
      | null;
  };

  const rawItems = (rows ?? []) as unknown as InventoryRow[];

  const mapped: (InventoryRowItem & {
    search_tags: string[] | null;
    merchant_name: string | null;
    category_name: string | null;
  })[] = rawItems.map((item) => {
    const category = Array.isArray(item.categories) ? item.categories[0] : item.categories;
    const orderItem = Array.isArray(item.order_items) ? item.order_items[0] : item.order_items;
    const merchantName = merchantNameFromItem(item);
    return {
      id: item.id,
      name: item.name,
      short_name: item.short_name,
      variant: item.variant,
      cost_cents: item.cost_cents,
      acquired_at: item.acquired_at,
      image_url: item.image_url ?? orderItem?.image_url ?? null,
      return_planned: item.return_planned,
      search_tags: item.search_tags,
      category_name: category?.name ?? null,
      category_color: category?.color ?? null,
      category_slug: category?.slug ?? null,
      merchant_name: merchantName,
    };
  });

  const searched = q ? filterAndRankBySearch(mapped, q) : mapped;
  // Relevance wins while searching; otherwise honor the sort control.
  const finalItems = q ? searched : sortInventoryItems(searched, sort);
  const groups = groupInventoryItems(finalItems, group);

  const filtered = Boolean(
    q || categoryId || activeMerchant || activeList || range !== 'all',
  );

  const hrefBase = {
    range,
    q: q || undefined,
    category: categoryId,
    merchant: activeMerchant,
    list: activeList,
    sort,
    group,
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <LeftRail>
        <RailGroup label="Acquired">
          {RANGES.map((entry) => (
            <RailItem
              key={entry.id}
              label={entry.label}
              active={entry.id === range}
              href={inventoryHref({ ...hrefBase, range: entry.id })}
            />
          ))}
        </RailGroup>
        <RailGroup label="List">
          <RailItem
            label="Any"
            active={!activeList}
            href={inventoryHref({ ...hrefBase, list: undefined })}
          />
          {(lists ?? []).map((list) => (
            <RailItem
              key={list.id}
              label={list.name}
              swatch={list.color ?? undefined}
              active={list.id === activeList}
              href={inventoryHref({ ...hrefBase, list: list.id })}
            />
          ))}
        </RailGroup>
        <RailGroup label="Merchant">
          <RailItem
            label="Any"
            active={!activeMerchant}
            href={inventoryHref({ ...hrefBase, merchant: undefined })}
          />
          {merchants.map((merchant) => (
            <RailItem
              key={merchant.id}
              label={merchant.name}
              active={merchant.id === activeMerchant}
              href={inventoryHref({ ...hrefBase, merchant: merchant.id })}
            />
          ))}
        </RailGroup>
        <RailGroup label="Category">
          <RailItem
            label="All"
            active={!categoryId}
            href={inventoryHref({ ...hrefBase, category: undefined })}
          />
          {(categories ?? []).map((category) => (
            <RailItem
              key={category.id}
              label={category.name}
              swatch={category.color ?? undefined}
              iconSlug={category.slug}
              active={category.id === categoryId}
              href={inventoryHref({ ...hrefBase, category: category.id })}
            />
          ))}
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Inventory"
          description="Everything you currently own, so you can check before buying it again."
        />

        <form className="mb-4 space-y-3" action="/inventory" method="get">
          {range !== 'all' && <input type="hidden" name="range" value={range} />}
          {categoryId && <input type="hidden" name="category" value={categoryId} />}
          {activeMerchant && (
            <input type="hidden" name="merchant" value={activeMerchant} />
          )}
          {activeList && <input type="hidden" name="list" value={activeList} />}

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
              strokeWidth={1.75}
              aria-hidden
            />
            <Input
              name="q"
              defaultValue={q}
              placeholder="Search what you own — try makeup, lipstick, kitchen…"
              aria-label="Search inventory"
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
              <ArrowUpDown className="size-3.5" strokeWidth={1.75} aria-hidden />
              <span className="sr-only">Sort</span>
              <Select
                name="sort"
                defaultValue={sort}
                className="h-9 w-auto min-w-[10rem]"
                aria-label="Sort inventory"
                disabled={Boolean(q)}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
              <Layers className="size-3.5" strokeWidth={1.75} aria-hidden />
              <span className="sr-only">Group</span>
              <Select
                name="group"
                defaultValue={group}
                className="h-9 w-auto min-w-[10rem]"
                aria-label="Group inventory"
              >
                {GROUP_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </label>
            <button
              type="submit"
              className="press h-9 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium text-ink-muted hover:text-ink"
            >
              Apply
            </button>
            {q && (
              <p className="text-[12px] text-ink-faint">
                Sorted by relevance while searching
              </p>
            )}
          </div>
        </form>

        {finalItems.length === 0 ? (
          <EmptyState
            icon={filtered ? SearchX : Package}
            title={filtered ? 'No matching items' : 'Nothing in your inventory yet'}
            description={
              filtered
                ? q
                  ? 'Nothing matched that search across names, tags, and categories. You probably don’t own it.'
                  : 'Try a different search, list, merchant, category, or date range.'
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
          <div className="space-y-5">
            {groups.map((section) => {
              const subtotal = section.items.reduce((sum, item) => sum + item.cost_cents, 0);
              return (
                <section key={section.key} className="space-y-2">
                  {group !== 'none' && (
                    <div className="flex items-baseline justify-between gap-3 px-1">
                      <h2 className="text-[13px] font-semibold text-ink">
                        {section.label}
                        <span className="ml-2 font-normal text-ink-faint">
                          {section.items.length}
                        </span>
                      </h2>
                      <p className="tabular text-[12px] text-ink-muted">
                        {formatMoney(subtotal)}
                      </p>
                    </div>
                  )}
                  <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
                    {section.items.map((item) => (
                      <InventoryRow key={item.id} item={item} />
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
