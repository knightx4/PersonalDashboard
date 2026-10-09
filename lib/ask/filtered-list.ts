import { filterAndRankBySearch } from '@/lib/inventory/search';
import { matchesAttributeFilters, parseAttributeFilters } from '@/lib/inventory/attribute-filters';
import { parseAttributeValues } from '@/lib/inventory/attributes';
import { displayName } from '@/lib/inventory/group-units';
import { filterPipeline, parsePipeline, type PipelineParams } from '@/lib/jobs/pipeline-view';
import { loadPipeline, type PipelineRow } from '@/lib/jobs/applications/load';
import { withApplicationNotes } from '@/lib/jobs/suggest/score-notes-load';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { formatMoney, periodFor, type PresetRange } from '@/lib/money';
import { BULK_MAX } from '@/lib/dash/bulk-items';
import { clip, type AskContext } from './db';
import { askListLabel, ASK_LISTS, type AskListFilter } from './list-filter';

/**
 * A filtered list read again on the server (plan #1658), so Ask Dash is told
 * which rows "these" are without the page sending any of them. The filter is
 * the address's own, and each list is filtered by the same functions its
 * page uses: the inventory's search, attribute and range rules, the
 * pipeline's filterPipeline. Read only, as the person, like every lookup.
 */

export type ListRow = {
  /** The row's id in `table`, which the change tools take as its ref. */
  ref: string;
  title: string;
  /** What a question about the rows needs at a glance: a cost and a date, or a stage. */
  facts: string;
};

export type ListContext = {
  list: AskListFilter['list'];
  /** "12 items from Inventory". */
  label: string;
  /** The table the refs are in, as the change tools name it. */
  table: string;
  /** How many rows match, including any past the cap. */
  total: number;
  /** The rows, at most BULK_MAX of them: the most one change may touch. */
  rows: ListRow[];
  /** The address of the list's page. */
  path: string;
};

const INVENTORY = 'public.inventory_items';
const APPLICATIONS = 'job_search.applications';
const RANGES: readonly PresetRange[] = ['this_month', 'last_month', 'last_3_months', 'ytd', 'last_12_months'];

type Embedded<T> = T | T[] | null;
const one = <T>(value: Embedded<T>): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

/** One owned item as the filter reads it. */
export type InventoryCandidate = {
  id: string;
  name: string;
  short_name: string | null;
  variant: string | null;
  cost_cents: number;
  acquired_at: string | null;
  search_tags: string[] | null;
  attributes: unknown;
  category_id: string | null;
  person_id: string | null;
  categories: Embedded<{ name: string }>;
  inventory_item_lists: Embedded<{ list_id: string }> | { list_id: string }[];
  order_items: Embedded<{
    orders: Embedded<{ merchant_id: string | null; deleted_at: string | null; merchants: Embedded<{ name: string }> }>;
  }>;
};

function merchantOf(item: InventoryCandidate) {
  const orderItem = one(item.order_items);
  const order = orderItem ? one(orderItem.orders) : null;
  return order ? { id: order.merchant_id, name: one(order.merchants)?.name ?? null, deleted: Boolean(order.deleted_at) } : null;
}

/**
 * The owned items the inventory page lists under `query`: its category,
 * person, merchant, list, attribute and search filters, in its own order of
 * applying them. The range is the database's, in `inventoryItems` below.
 */
export function inventoryMatches(items: readonly InventoryCandidate[], query: string): InventoryCandidate[] {
  const params = new URLSearchParams(query);
  const category = params.get('category')?.trim();
  const person = params.get('person')?.trim();
  const merchant = params.get('merchant')?.trim();
  const list = params.get('list')?.trim();
  const attrs = parseAttributeFilters(params.getAll('attr'));
  const q = (params.get('q') ?? '')
    .trim()
    .replace(/[%_,*()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const kept = items
    // An item on a deleted order is not on the page.
    .filter((item) => !merchantOf(item)?.deleted)
    .filter((item) => !category || item.category_id === category)
    .filter((item) => !person || item.person_id === person)
    .filter((item) => !merchant || merchantOf(item)?.id === merchant)
    .filter((item) => {
      if (!list) return true;
      const memberships = Array.isArray(item.inventory_item_lists)
        ? item.inventory_item_lists
        : item.inventory_item_lists
          ? [item.inventory_item_lists]
          : [];
      return memberships.some((entry) => entry.list_id === list);
    })
    .filter((item) => attrs.length === 0 || matchesAttributeFilters(parseAttributeValues(item.attributes), attrs));
  if (!q) return kept;
  return filterAndRankBySearch(
    kept.map((item) => ({
      item,
      id: item.id,
      name: item.name,
      short_name: item.short_name,
      variant: item.variant,
      search_tags: item.search_tags,
      category_name: one(item.categories)?.name ?? null,
      merchant_name: merchantOf(item)?.name ?? null,
    })),
    q,
  ).map((entry) => entry.item);
}

async function inventoryItems(ctx: AskContext, query: string): Promise<InventoryCandidate[]> {
  const range = new URLSearchParams(query).get('range') ?? 'all';
  const period = (RANGES as readonly string[]).includes(range)
    ? periodFor(range as PresetRange, ctx.timezone ?? 'UTC')
    : null;
  const client = await ctx.db('public');
  let read = client
    .from('inventory_items')
    .select(
      `id, name, short_name, variant, cost_cents, acquired_at, search_tags, attributes, category_id, person_id,
       categories(name), inventory_item_lists(list_id),
       order_items(orders(merchant_id, deleted_at, merchants(name)))`,
    )
    .eq('user_id', ctx.userId)
    .eq('status', 'owned')
    .order('acquired_at', { ascending: false });
  if (period) read = read.gte('acquired_at', period.start).lte('acquired_at', period.end);
  const { data, error } = await read;
  if (error) throw new Error(`inventory_items: ${error.message}`);
  return (data ?? []) as unknown as InventoryCandidate[];
}

/** The applications the Pipeline page lists under `query`. */
export function pipelineMatches(rows: readonly PipelineRow[], query: string): PipelineRow[] {
  const params: PipelineParams = {};
  for (const key of ['status', 'source', 'excitement', 'minfit', 'minchance', 'q'] as const) {
    const value = new URLSearchParams(query).get(key);
    if (value) params[key] = value;
  }
  return filterPipeline(rows, parsePipeline(params)).filtered;
}

function capped(rows: ListRow[]): ListRow[] {
  return rows.slice(0, BULK_MAX);
}

/**
 * The rows a filter picks out, or null when its workspace is off or the read
 * failed: Dash is then told nothing about the list rather than a guess.
 */
export async function resolveFilteredList(ctx: AskContext, filter: AskListFilter): Promise<ListContext | null> {
  const meta = ASK_LISTS[filter.list];
  try {
    if (filter.list === 'inventory') {
      if (!ctx.enabledModules.includes('shopping')) return null;
      const items = inventoryMatches(await inventoryItems(ctx, filter.query), filter.query);
      const rows = capped(
        items.map((item) => ({
          ref: item.id,
          title: clip(displayName(item), 80) ?? item.id,
          facts: [formatMoney(item.cost_cents), item.acquired_at ?? 'no date'].join(', '),
        })),
      );
      return {
        list: filter.list,
        label: askListLabel(filter.list, items.length),
        table: INVENTORY,
        total: items.length,
        rows,
        path: meta.path,
      };
    }
    if (!ctx.enabledModules.includes('jobs')) return null;
    const client = (await ctx.db('job_search')) as unknown as AppSupabaseClient;
    const all = await withApplicationNotes(client, ctx.userId, await loadPipeline(client, ctx.userId));
    const matched = pipelineMatches(all, filter.query);
    const rows = capped(
      matched.map((row) => ({
        ref: row.applicationId,
        title: clip(`${row.roleTitle} at ${row.companyName}`, 80) ?? row.applicationId,
        facts: [row.status, row.submittedAt ? `applied ${row.submittedAt.slice(0, 10)}` : 'not applied'].join(', '),
      })),
    );
    return {
      list: filter.list,
      label: askListLabel(filter.list, matched.length),
      table: APPLICATIONS,
      total: matched.length,
      rows,
      path: meta.path,
    };
  } catch {
    return null;
  }
}
