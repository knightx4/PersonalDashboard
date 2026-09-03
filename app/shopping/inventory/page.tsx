import { ArrowUpDown, Layers, Package, Search, SearchX } from 'lucide-react';
import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { InventoryRow, type InventoryRowItem } from '@/components/inventory/inventory-row';
import { LeftRail, RailChip, RailGroup, RailItem, RailPicker } from '@/components/shell/left-rail';
import { AttributeFilterPicker } from './attribute-filter-picker';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { backfillUserInventoryDisplay } from '@/lib/inventory/backfill-display';
import { filterAndRankBySearch } from '@/lib/inventory/search';
import {
  attributeFacets,
  attributeLabelMap,
  matchesAttributeFilters,
  parseAttributeFilters,
  serializeAttributeFilter,
  type AttributeFilter,
} from '@/lib/inventory/attribute-filters';
import { parseAttributeValues, parseTemplateFields } from '@/lib/inventory/attributes';
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
import { createCoreClient } from '@/lib/core/auth/server';
import { loadPeople, parsePersonFilter, peopleById } from '@/lib/people/load';

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
  person?: string;
  attrs?: AttributeFilter[];
}): string {
  const params = new URLSearchParams();
  if (opts.range && opts.range !== 'all') params.set('range', opts.range);
  if (opts.q) params.set('q', opts.q);
  if (opts.category) params.set('category', opts.category);
  if (opts.merchant) params.set('merchant', opts.merchant);
  if (opts.list) params.set('list', opts.list);
  if (opts.sort && opts.sort !== 'newest') params.set('sort', opts.sort);
  if (opts.group && opts.group !== 'none') params.set('group', opts.group);
  if (opts.person) params.set('person', opts.person);
  for (const attr of opts.attrs ?? []) params.append('attr', serializeAttributeFilter(attr));
  const qs = params.toString();
  return qs ? `/shopping/inventory?${qs}` : '/shopping/inventory';
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
    person?: string;
    attr?: string | string[];
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
  const attrFilters = parseAttributeFilters(params.attr);

  await backfillUserInventoryDisplay(supabase, user.id);

  const core = await createCoreClient();
  const people = await loadPeople(core, user.id);
  const personId = parsePersonFilter(params.person, people);
  const byPerson = peopleById(people);
  const showPeople = people.length > 1;

  const [
    { data: categories },
    { data: lists },
    merchants,
    { data: profile },
    { data: attributeTemplates },
  ] = await Promise.all([
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
    supabase.from('category_attribute_templates').select('fields').eq('user_id', user.id),
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
        id, name, short_name, variant, cost_cents, acquired_at, status, category_id, person_id,
        image_url, return_planned, search_tags, attributes,
        categories(name, color, slug),
        ${membershipJoin},
        order_items!inner (
          image_url,
          orders!inner (
            merchant_id, deleted_at,
            merchants ( name )
          )
        )
      `
    : `
        id, name, short_name, variant, cost_cents, acquired_at, status, category_id, person_id,
        image_url, return_planned, search_tags, attributes,
        categories(name, color, slug),
        ${membershipJoin},
        order_items (
          image_url,
          orders (
            merchant_id, deleted_at,
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
  if (personId) query = query.eq('person_id', personId);
  if (activeMerchant) {
    query = query
      .eq('order_items.orders.merchant_id', activeMerchant)
      .is('order_items.orders.deleted_at', null);
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
    person_id?: string | null;
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
    attributes: unknown;
    inventory_item_lists:
      | { list_id: string }
      | { list_id: string }[]
      | null;
    categories:
      | { name: string; color: string | null; slug: string }
      | { name: string; color: string | null; slug: string }[]
      | null;
    order_items:
      | {
          image_url: string | null;
          orders:
            | {
                deleted_at?: string | null;
                merchants: { name: string } | { name: string }[] | null;
              }
            | {
                deleted_at?: string | null;
                merchants: { name: string } | { name: string }[] | null;
              }[]
            | null;
        }
      | {
          image_url: string | null;
          orders:
            | {
                deleted_at?: string | null;
                merchants: { name: string } | { name: string }[] | null;
              }
            | {
                deleted_at?: string | null;
                merchants: { name: string } | { name: string }[] | null;
              }[]
            | null;
        }[]
      | null;
  };

  const rawItems = ((rows ?? []) as unknown as InventoryRow[]).filter((item) => {
    const orderItem = Array.isArray(item.order_items) ? item.order_items[0] : item.order_items;
    const order = orderItem
      ? Array.isArray(orderItem.orders)
        ? orderItem.orders[0]
        : orderItem.orders
      : null;
    return !order?.deleted_at;
  });

  const mapped: (InventoryRowItem & {
    search_tags: string[] | null;
    merchant_name: string | null;
    category_name: string | null;
    attributes: Record<string, string>;
  })[] = rawItems.map((item) => {
    const category = Array.isArray(item.categories) ? item.categories[0] : item.categories;
    const orderItem = Array.isArray(item.order_items) ? item.order_items[0] : item.order_items;
    const merchantName = merchantNameFromItem(item);
    const memberships = Array.isArray(item.inventory_item_lists)
      ? item.inventory_item_lists
      : item.inventory_item_lists
        ? [item.inventory_item_lists]
        : [];
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
      attributes: parseAttributeValues(item.attributes),
      person: showPeople ? (byPerson.get(item.person_id ?? '') ?? null) : null,
      category_name: category?.name ?? null,
      category_color: category?.color ?? null,
      category_slug: category?.slug ?? null,
      merchant_name: merchantName,
      list_ids: memberships.map((row) => row.list_id),
    };
  });

  // Facets come from everything the other filters left, so the properties on
  // offer do not vanish the moment one of them is picked.
  const facets = attributeFacets(
    mapped,
    attributeLabelMap(
      (attributeTemplates ?? []).map((row) => parseTemplateFields(row.fields)),
      (categories ?? []).map((category) => category.slug),
    ),
  );
  const byAttributes = attrFilters.length
    ? mapped.filter((item) => matchesAttributeFilters(item.attributes, attrFilters))
    : mapped;

  const searched = q ? filterAndRankBySearch(byAttributes, q) : byAttributes;
  // Relevance wins while searching; otherwise honor the sort control.
  const finalItems = q ? searched : sortInventoryItems(searched, sort);
  const groups = groupInventoryItems(finalItems, group);

  const filtered = Boolean(
    q || categoryId || activeMerchant || activeList || range !== 'all' || attrFilters.length,
  );

  // person rides in the base, so every other filter link keeps it rather than
  // silently dropping back to everyone.
  const hrefBase = {
    range,
    q: q || undefined,
    category: categoryId,
    merchant: activeMerchant,
    list: activeList,
    sort,
    group,
    person: personId ?? undefined,
    attrs: attrFilters,
  };

  // Every value a property can be filtered to, as a ready-made link, so the
  // picker stays a client component that only chooses between hrefs.
  const attrHrefs: Record<string, Record<string, string>> = {};
  for (const facet of facets) {
    attrHrefs[facet.key] = Object.fromEntries(
      facet.values
        .filter(
          (value) =>
            !attrFilters.some(
              (filter) =>
                filter.key === facet.key &&
                filter.value.toLowerCase() === value.toLowerCase(),
            ),
        )
        .map((value) => [
          value,
          inventoryHref({
            ...hrefBase,
            // One value per property: picking another replaces it.
            attrs: [
              ...attrFilters.filter((filter) => filter.key !== facet.key),
              { key: facet.key, value },
            ],
          }),
        ]),
    );
  }

  const facetLabels = new Map(facets.map((facet) => [facet.key, facet.label]));

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
        {showPeople && (
          <RailGroup label="Whose">
            <RailItem
              label="Everyone"
              active={!personId}
              href={inventoryHref({ ...hrefBase, person: undefined })}
            />
            {people.map((person) => (
              <RailItem
                key={person.id}
                label={person.name}
                active={personId === person.id}
                href={inventoryHref({ ...hrefBase, person: person.id })}
              />
            ))}
          </RailGroup>
        )}

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
        <RailPicker
          label="Merchant"
          activeId={activeMerchant}
          anyHref={inventoryHref({ ...hrefBase, merchant: undefined })}
          placeholder="Type a merchant…"
          options={merchants.map((merchant) => ({
            id: merchant.id,
            label: merchant.name,
            href: inventoryHref({ ...hrefBase, merchant: merchant.id }),
          }))}
        />
        <RailGroup label="Property">
          {attrFilters.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1 px-1">
              {attrFilters.map((filter) => (
                <RailChip
                  key={`${filter.key}:${filter.value}`}
                  label={`${facetLabels.get(filter.key) ?? filter.key}: ${filter.value}`}
                  removeHref={inventoryHref({
                    ...hrefBase,
                    attrs: attrFilters.filter(
                      (entry) => !(entry.key === filter.key && entry.value === filter.value),
                    ),
                  })}
                />
              ))}
            </div>
          )}
          <AttributeFilterPicker facets={facets} hrefFor={attrHrefs} />
          {facets.length === 0 && (
            <p className="px-2.5 py-1.5 text-[13px] text-ink-faint">
              None of these items have details recorded yet.
            </p>
          )}
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
          actions={
            <Link
              href="/shopping/inventory/add"
              className={buttonVariants({ variant: 'primary', size: 'sm' })}
            >
              Add owned books
            </Link>
          }
        />

        <form className="mb-4 space-y-3" action="/shopping/inventory" method="get">
          {range !== 'all' && <input type="hidden" name="range" value={range} />}
          {categoryId && <input type="hidden" name="category" value={categoryId} />}
          {activeMerchant && (
            <input type="hidden" name="merchant" value={activeMerchant} />
          )}
          {activeList && <input type="hidden" name="list" value={activeList} />}
          {personId && <input type="hidden" name="person" value={personId} />}
          {attrFilters.map((filter) => (
            <input
              key={`${filter.key}:${filter.value}`}
              type="hidden"
              name="attr"
              value={serializeAttributeFilter(filter)}
            />
          ))}

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
                ? { label: 'Clear filters', href: '/shopping/inventory' }
                : { label: 'Add owned books', href: '/shopping/inventory/add' }
            }
            secondaryAction={
              filtered
                ? undefined
                : { label: 'Add an order', href: '/shopping/orders/new' }
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
                      <InventoryRow
                        key={item.id}
                        item={item}
                        lists={(lists ?? []).map((list) => ({
                          id: list.id,
                          name: list.name,
                        }))}
                      />
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
