import 'server-only';

import { createClient } from '@/lib/auth/server';
import type {
  SearchContext,
  SearchHit,
  SearchListContext,
  SearchSource,
} from '@/lib/search/sources';
import { embedded, escapeLike, inventoryHit, orderHit, savedHit } from '@/lib/search/sources/map';

/**
 * Shopping, in the command palette.
 *
 * "A shopping item" is three different things here and this covers all three:
 * an order line, something you own, and something you are thinking about
 * buying. Leaving one out is the kind of gap you would only notice while
 * looking for the thing that was left out.
 *
 * An order is found by its merchant or its order number rather than by the
 * things in it -- the row you are looking for when you type "amazon" is the
 * order, and the item inside it has its own row in inventory.
 */

const contains = (query: string) => `%${escapeLike(query)}%`;

/** A search, or -- with no query -- everything. */
type Read = SearchListContext & { query?: string };

const ORDER_COLUMNS = 'id, external_order_number, order_date, total_cents, merchants(name)';

type OrderRow = {
  id: string;
  external_order_number: string | null;
  order_date: string | null;
  merchants: { name: string } | { name: string }[] | null;
};

/** Each order once, in the order the reads returned it. */
function orderHits(rows: OrderRow[]): SearchHit[] {
  const seen = new Set<string>();
  const hits: SearchHit[] = [];

  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);

    hits.push(
      orderHit({
        id: row.id,
        external_order_number: row.external_order_number,
        order_date: row.order_date,
        merchant: embedded(row.merchants),
      }),
    );
  }

  return hits;
}

async function findOrders(ctx: Read): Promise<SearchHit[]> {
  const supabase = await createClient();

  // Nothing to match against, so the two reads below are one read.
  if (!ctx.query) {
    const { data, error } = await supabase
      .from('orders')
      .select(ORDER_COLUMNS)
      .is('deleted_at', null)
      .order('order_date', { ascending: false })
      .limit(ctx.limit);

    if (error) throw new Error(`orders: ${error.message}`);

    return orderHits((data ?? []) as unknown as OrderRow[]);
  }

  const pattern = contains(ctx.query);

  const { data, error } = await supabase
    .from('orders')
    .select(ORDER_COLUMNS)
    .is('deleted_at', null)
    // `.ilike()` rather than an `or` expression holding the one condition: the
    // pattern goes out as its own parameter, so a comma in the order number
    // somebody typed is ordinary text rather than a second condition.
    .ilike('external_order_number', pattern)
    .order('order_date', { ascending: false })
    .limit(ctx.limit);

  if (error) throw new Error(`orders by number: ${error.message}`);

  // By merchant as well, which is how somebody actually looks for an order.
  // A second read rather than an `or` across the join, because PostgREST
  // cannot filter on an embedded table from inside an `or`.
  const { data: byMerchant, error: merchantError } = await supabase
    .from('orders')
    .select('id, external_order_number, order_date, total_cents, merchants!inner(name)')
    .is('deleted_at', null)
    .ilike('merchants.name', pattern)
    .order('order_date', { ascending: false })
    .limit(ctx.limit);

  if (merchantError) throw new Error(`orders by merchant: ${merchantError.message}`);

  return orderHits([
    ...((data ?? []) as unknown as OrderRow[]),
    ...((byMerchant ?? []) as unknown as OrderRow[]),
  ]);
}

async function findInventory(ctx: Read): Promise<SearchHit[]> {
  const supabase = await createClient();
  let read = supabase.from('inventory_items').select('id, name, variant, status');
  if (ctx.query) read = read.ilike('name', contains(ctx.query));

  const { data, error } = await read.order('updated_at', { ascending: false }).limit(ctx.limit);

  if (error) throw new Error(`inventory: ${error.message}`);

  return ((data ?? []) as {
    id: string;
    name: string;
    variant: string | null;
    status: string;
  }[]).map(inventoryHit);
}

async function findSaved(ctx: Read): Promise<SearchHit[]> {
  const supabase = await createClient();
  let read = supabase.from('saved_items').select('id, title, status, merchants(name)');
  if (ctx.query) read = read.ilike('title', contains(ctx.query));

  const { data, error } = await read.order('updated_at', { ascending: false }).limit(ctx.limit);

  if (error) throw new Error(`saved: ${error.message}`);

  return ((data ?? []) as unknown as {
    id: string;
    title: string;
    status: string;
    merchants: { name: string } | { name: string }[] | null;
  }[]).map((row) =>
    savedHit({ id: row.id, title: row.title, merchant: embedded(row.merchants) }),
  );
}

async function read(ctx: Read): Promise<SearchHit[]> {
  const [orders, inventory, saved] = await Promise.all([
    findOrders(ctx),
    findInventory(ctx),
    findSaved(ctx),
  ]);
  return [...orders, ...inventory, ...saved];
}

export const shoppingSearchSource: SearchSource = {
  id: 'shopping',
  module: 'shopping',
  label: 'Shopping',
  kinds: ['order', 'inventory', 'saved'],
  find(ctx: SearchContext) {
    return read(ctx);
  },
  list(ctx: SearchListContext) {
    return read(ctx);
  },
};
