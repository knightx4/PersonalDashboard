import { Receipt } from 'lucide-react';
import Link from 'next/link';
import { createClient, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { defaultViewHref, savedViewsFor } from '@/lib/saved-views/store';
import { redirect } from 'next/navigation';
import { countConnectedInboxes } from '@/lib/core/inbox/accounts';

type OrderSourceMessage = {
  subject: string | null;
  from_address: string | null;
  classification: string | null;
  email_address: string | null;
};

import { OrderRow } from '@/components/orders/order-row';
import { LeftRail, RailGroup, RailItem } from '@/components/shell/left-rail';
import { PageHeader } from '@/components/shell/page-header';
import { SearchEmpty } from '@/components/shell/search-empty';
import { SearchField } from '@/components/shell/search-field';
import { FilterChips, type FilterChip } from '@/components/shell/filter-chips';
import { EmptyState } from '@/components/ui/empty-state';
import { buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { convertToDisplayCents, loadDisplayCurrency } from '@/lib/fx/display';
import { normalizeCurrencyCode } from '@/lib/fx/money-fx';
import { loadUserMerchants, parseMerchantId } from '@/lib/merchants/user-merchants';
import { formatMoney, periodFor, type PresetRange } from '@/lib/money';
import { DEFAULT_ORDERS_GROUP, ordersDisplay } from '@/lib/orders/list-display';
import {
  groupRows,
  listDisplayMenu,
  NO_GROUP,
  parseListDisplay,
  sortRows,
} from '@/lib/list-display';
import { DisplayMenu } from '@/components/shell/display-menu';
import { GroupHeader } from '@/components/shell/group-header';
import {
  matchingItemHint,
  orderHasTagId,
  orderInboxAddress,
  orderItemsSummary,
  orderMatchesQuery,
  sanitizeOrdersQuery,
} from '@/lib/orders/search';
import { loadUserTags, parseTagId } from '@/lib/tags/ensure';
import { loadPeople, parsePersonFilter, peopleById } from '@/lib/people/load';

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

function hrefFor(opts: {
  range: PresetRange;
  status?: string;
  merchant?: string;
  tag?: string;
  q?: string;
  person?: string;
  sort?: string;
  group?: string;
  hide?: readonly string[];
}): string {
  const params = new URLSearchParams({ range: opts.range });
  if (opts.status) params.set('status', opts.status);
  if (opts.merchant) params.set('merchant', opts.merchant);
  if (opts.tag) params.set('tag', opts.tag);
  if (opts.q) params.set('q', opts.q);
  if (opts.person) params.set('person', opts.person);
  // The arrangement rides along, so changing a filter does not put the sort,
  // the grouping and the hidden lines back to their defaults.
  if (opts.sort && opts.sort !== 'newest') params.set('sort', opts.sort);
  if (opts.group && opts.group !== DEFAULT_ORDERS_GROUP) params.set('group', opts.group);
  if (opts.hide && opts.hide.length > 0) params.set('hide', opts.hide.join(','));
  return `/shopping/orders?${params.toString()}`;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: string;
    status?: string;
    merchant?: string;
    tag?: string;
    q?: string;
    person?: string;
    sort?: string;
    group?: string;
    hide?: string | string[];
  }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const core = await createCoreClient();
  const params = await searchParams;

  const range =
    RANGES.find((entry) => entry.id === params.range)?.id ?? 'last_12_months';
  const status = STATUSES.find((entry) => entry.id === params.status)?.id;
  const merchantId = parseMerchantId(params.merchant);
  const tagId = parseTagId(params.tag);
  const q = sanitizeOrdersQuery(params.q);

  const [{ data: profile }, merchants, tags, inboxCount, displayCurrency, people] =
    await Promise.all([
      supabase.from('profiles').select('timezone').eq('id', user.id).single(),
      loadUserMerchants(supabase, user.id),
      loadUserTags(supabase, user.id),
      countConnectedInboxes(core, user.id),
      loadDisplayCurrency(supabase, user.id),
      loadPeople(core, user.id),
    ]);
  const personId = parsePersonFilter(params.person, people);
  const byPerson = peopleById(people);
  // The whole feature is invisible on a one-person account, which is right:
  // there is nothing to tell apart.
  const showPeople = people.length > 1;
  const timezone = profile?.timezone ?? 'UTC';
  const period = periodFor(range, timezone);
  const activeMerchant =
    merchantId && merchants.some((entry) => entry.id === merchantId)
      ? merchantId
      : undefined;
  const activeTag =
    tagId && tags.some((entry) => entry.id === tagId) ? tagId : undefined;
  const showInbox = (inboxCount ?? 0) > 1;

  let query = supabase
    .from('orders')
    .select(
      `
      id, order_date, total_cents, currency, status, external_order_number, person_id,
      merchants ( name, logo_url, domains ),
      order_items (
        name, variant, quantity, image_url, categories ( name ),
        order_item_tags ( tag_id, item_tags ( id, name, slug ) )
      )
    `,
    )
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .gte('order_date', period.start)
    .lte('order_date', period.end)
    .order('order_date', { ascending: false });

  if (status) query = query.eq('status', status);
  if (activeMerchant) query = query.eq('merchant_id', activeMerchant);
  if (personId) query = query.eq('person_id', personId);

  const { data: rows, error } = await query;
  if (error) throw error;

  // The source emails come from the view in a second query rather than an
  // embed: their subjects and senders live in core, which PostgREST cannot
  // reach across from an embedded resource.
  const orderRows = rows ?? [];
  const sourceByOrder = new Map<string, OrderSourceMessage[]>();
  if (orderRows.length > 0) {
    const { data: sources } = await supabase
      .from('inbox_messages')
      .select('resulting_order_id, subject, from_address, classification, email_address')
      .in(
        'resulting_order_id',
        orderRows.map((row) => row.id as string),
      );
    for (const row of sources ?? []) {
      const orderId = row.resulting_order_id as string | null;
      if (!orderId) continue;
      const list = sourceByOrder.get(orderId) ?? [];
      list.push({
        subject: (row.subject as string | null) ?? null,
        from_address: (row.from_address as string | null) ?? null,
        classification: (row.classification as string | null) ?? null,
        email_address: (row.email_address as string | null) ?? null,
      });
      sourceByOrder.set(orderId, list);
    }
  }

  let orders = orderRows.map((row) => ({
    ...row,
    ingested_messages: sourceByOrder.get(row.id as string) ?? [],
  }));
  if (activeTag) {
    orders = orders.filter((order) => orderHasTagId(order, activeTag));
  }
  if (q) {
    orders = orders.filter((order) => orderMatchesQuery(order, q));
  }

  const displayTotals =
    orders.length > 0
      ? await convertToDisplayCents(
          supabase,
          orders.map((order) => ({
            cents: order.total_cents,
            currency: order.currency,
            date: order.order_date,
          })),
          displayCurrency,
        )
      : [];


  const displayById = new Map(
    orders.map((order, index) => [order.id, displayTotals[index] ?? order.total_cents]),
  );

  // One row shape for the arrangement to work on, with the total already in the
  // display currency: sorting a mix of native totals would put a 50,000 yen
  // order above a 400 dollar one, and a group subtotal would add them up.
  const arrangeable = orders.map((order) => {
    const merchant = Array.isArray(order.merchants) ? order.merchants[0] : order.merchants;
    const status = STATUSES.find((entry) => entry.id === order.status);
    return {
      order,
      orderDate: order.order_date as string,
      displayTotalCents: displayById.get(order.id) ?? order.total_cents,
      merchantName: merchant?.name ?? 'Unknown merchant',
      status: (order.status as string) ?? '',
      statusLabel: status?.label ?? 'Unknown',
      statusRank: STATUSES.findIndex((entry) => entry.id === order.status),
      personName: showPeople ? (byPerson.get(order.person_id)?.name ?? null) : null,
    };
  });

  const displaySpec = ordersDisplay<(typeof arrangeable)[number]>({ withPeople: showPeople });
  const display = parseListDisplay(displaySpec, params);
  const savedViews = await savedViewsFor(core, displaySpec.pathname);
  const openOn = defaultViewHref(savedViews, params);
  if (openOn) redirect(openOn);
  const menu = listDisplayMenu(displaySpec, params, savedViews);

  /** A filter link that keeps the arrangement, since changing one is not changing the other. */
  const filterHref = (opts: Parameters<typeof hrefFor>[0]) =>
    hrefFor({ sort: display.sort, group: display.group, hide: display.hidden, ...opts });

  const sections = groupRows(sortRows(arrangeable, display), display.groupBy, (rows) =>
    rows.reduce((sum, row) => sum + row.displayTotalCents, 0),
  );

  // A search that matched nothing is the shared empty state; this is the other
  // kind of nothing, where a filter rather than a search emptied the list.
  const filteredEmpty =
    orders.length === 0 && Boolean(status || activeMerchant || activeTag);

  /** What is narrowing this page, said out loud above the results. */
  const chips: FilterChip[] = [];
  if (q) {
    chips.push({
      label: 'Search',
      value: q,
      clearHref: filterHref({ range, status, merchant: activeMerchant, tag: activeTag, person: personId ?? undefined }),
    });
  }
  if (activeMerchant) {
    const merchant = merchants.find((entry) => entry.id === activeMerchant);
    if (merchant) {
      chips.push({
        label: 'Merchant',
        value: merchant.name,
        clearHref: filterHref({ range, status, tag: activeTag, q: q || undefined, person: personId ?? undefined }),
      });
    }
  }
  if (activeTag) {
    const tag = tags.find((entry) => entry.id === activeTag);
    if (tag) {
      chips.push({
        label: 'Tag',
        value: tag.name,
        clearHref: filterHref({ range, status, merchant: activeMerchant, q: q || undefined, person: personId ?? undefined }),
      });
    }
  }
  if (status) {
    const entry = STATUSES.find((option) => option.id === status);
    if (entry) {
      chips.push({
        label: 'Status',
        value: entry.label,
        clearHref: filterHref({ range, merchant: activeMerchant, tag: activeTag, q: q || undefined, person: personId ?? undefined }),
      });
    }
  }
  if (personId) {
    const person = byPerson.get(personId);
    if (person) {
      chips.push({
        label: 'Whose',
        value: person.name,
        clearHref: filterHref({ range, status, merchant: activeMerchant, tag: activeTag, q: q || undefined }),
      });
    }
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row">
      <LeftRail>
        <RailGroup label="Time range">
          {RANGES.map((entry) => (
            <RailItem
              key={entry.id}
              label={entry.label}
              active={entry.id === range}
              href={filterHref({
                range: entry.id,
                status,
                merchant: activeMerchant,
                tag: activeTag,
                q: q || undefined, person: personId ?? undefined })}
            />
          ))}
        </RailGroup>
        {showPeople && (
          <RailGroup label="Whose">
            <RailItem
              label="Everyone"
              active={!personId}
              href={filterHref({
                range,
                status,
                merchant: activeMerchant,
                tag: activeTag,
                q: q || undefined,
              })}
            />
            {people.map((person) => (
              <RailItem
                key={person.id}
                label={person.name}
                active={personId === person.id}
                href={filterHref({
                  range,
                  status,
                  merchant: activeMerchant,
                  tag: activeTag,
                  q: q || undefined,
                  person: person.id,
                })}
              />
            ))}
          </RailGroup>
        )}

        <RailGroup label="Merchant">
          <RailItem
            label="Any"
            active={!activeMerchant}
            href={filterHref({ range, status, tag: activeTag, q: q || undefined, person: personId ?? undefined })}
          />
          {merchants.map((merchant) => (
            <RailItem
              key={merchant.id}
              label={merchant.name}
              active={merchant.id === activeMerchant}
              href={filterHref({
                range,
                status,
                merchant: merchant.id,
                tag: activeTag,
                q: q || undefined, person: personId ?? undefined })}
            />
          ))}
        </RailGroup>
        {tags.length > 0 && (
          <RailGroup label="Tag">
            <RailItem
              label="Any"
              active={!activeTag}
              href={filterHref({
                range,
                status,
                merchant: activeMerchant,
                q: q || undefined, person: personId ?? undefined })}
            />
            {tags.map((tag) => (
              <RailItem
                key={tag.id}
                label={tag.name}
                active={tag.id === activeTag}
                href={filterHref({
                  range,
                  status,
                  merchant: activeMerchant,
                  tag: tag.id,
                  q: q || undefined, person: personId ?? undefined })}
              />
            ))}
          </RailGroup>
        )}
        <RailGroup label="Status">
          <RailItem
            label="Any"
            active={!status}
            href={filterHref({
              range,
              merchant: activeMerchant,
              tag: activeTag,
              q: q || undefined, person: personId ?? undefined })}
          />
          {STATUSES.map((entry) => (
            <RailItem
              key={entry.id}
              label={entry.label}
              active={entry.id === status}
              href={filterHref({
                range,
                status: entry.id,
                merchant: activeMerchant,
                tag: activeTag,
                q: q || undefined, person: personId ?? undefined })}
            />
          ))}
        </RailGroup>
      </LeftRail>

      <div className="min-w-0 flex-1">
        <PageHeader
          title="Orders"
          description="Everything you have bought, newest first."
          actions={
            <Link href="/shopping/orders/new" className={buttonVariants({ size: 'sm' })}>
              Add an order
            </Link>
          }
        />

        <FilterChips chips={chips} clearAllHref="/shopping/orders" />

        {/* Directly above the list it narrows, under the chips that say what
            is already in force. The range, the status, the merchant, the tag,
            whose it is and the arrangement are all on the URL, and the field
            carries them, so searching from a narrowed list stays narrowed. */}
        <div className="mb-5">
          <SearchField placeholder="Search merchant, item, tag, order #, inbox…" />

          {/* The list was locked into months and had no sort control at all.
              Same control, same place, as the one above the inventory list. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <DisplayMenu menu={menu} align="start" />
          </div>
        </div>

        {orders.length === 0 && q ? (
          <SearchEmpty query={q} />
        ) : orders.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={filteredEmpty ? 'No matching orders' : 'No orders yet'}
            description={
              filteredEmpty
                ? 'Try a different search, merchant, tag, status, or time range.'
                : 'Orders appear here as we find them in your inboxes, grouped by month. You can also add one by hand at any time.'
            }
            action={
              filteredEmpty
                ? { label: 'Clear filters', href: filterHref({ range: 'last_12_months', person: personId ?? undefined }) }
                : { label: 'Add an order', href: '/shopping/orders/new' }
            }
            secondaryAction={
              filteredEmpty ? undefined : { label: 'Connect an inbox', href: '/shopping/settings#inboxes' }
            }
          />
        ) : (
          <div className="space-y-8">
            {sections.map((section) => (
              <section key={section.key}>
                {display.group !== NO_GROUP && (
                  <GroupHeader
                    label={section.label}
                    count={section.count}
                    subtotal={formatMoney(section.subtotal ?? 0, displayCurrency)}
                    className="mb-3 px-0.5"
                  />
                )}
                <ul className={cn(cardVariants({ padding: 'none' }), 'divide-y divide-border overflow-hidden')}>
                  {section.rows.map((row) => {
                    const order = row.order;
                    const merchant = Array.isArray(order.merchants)
                      ? order.merchants[0]
                      : order.merchants;
                    const itemsSummary = orderItemsSummary(order);
                    const itemHint = q ? matchingItemHint(order, q) : null;
                    const inbox = showInbox && !display.hidden.includes('inbox')
                      ? orderInboxAddress(order)
                      : null;
                    const nativeDiffers =
                      normalizeCurrencyCode(order.currency) !==
                      normalizeCurrencyCode(displayCurrency);
                    return (
                      <OrderRow
                        key={order.id}
                        order={{
                          id: order.id,
                          order_date: order.order_date,
                          total_cents: row.displayTotalCents,
                          currency: displayCurrency,
                          native_total_cents: nativeDiffers ? order.total_cents : undefined,
                          native_currency: nativeDiffers ? order.currency : undefined,
                          status: order.status,
                          external_order_number: display.hidden.includes('number')
                            ? null
                            : order.external_order_number,
                          merchant_name: merchant?.name ?? 'Unknown merchant',
                          merchant_logo_url: merchant?.logo_url ?? null,
                          merchant_domains: merchant?.domains ?? null,
                          items_label: display.hidden.includes('items') ? '' : itemsSummary.label,
                          item_hint: itemHint,
                          inbox,
                          person:
                            showPeople && !display.hidden.includes('person')
                              ? byPerson.get(order.person_id)
                              : null,
                        }}
                      />
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
