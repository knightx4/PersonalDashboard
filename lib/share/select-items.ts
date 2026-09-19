import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Choosing what goes on a share.
 *
 * This exists so "put all my board games on the form" is one call with one
 * object, rather than a walk through the inventory UI. It is the AI-facing
 * half of the feature: the filter shape below is the vocabulary an instruction
 * gets translated into, and it deliberately mirrors the filters the inventory
 * page already parses, so the two never drift into meaning different things.
 *
 * Everything runs through the caller's own RLS-bound client. `userId` narrows
 * the query for the planner's benefit; it is not what makes it safe.
 */

export type ShareFilter = {
  /** e.g. 'board-games'. Matches the category on the item itself. */
  categorySlug?: string;
  /** A user-facing tag, via inventory_item_tags. */
  tagSlug?: string;
  /** An item_lists id. */
  listId?: string;
  /** Only things bought from one merchant. */
  merchantId?: string;
  /** Substring of the name or short name. */
  q?: string;
  /** Only things with a game_details row. */
  gamesOnly?: boolean;
  /**
   * Default false. A form asking whether to keep something you already sold is
   * a form that wastes her time, so disposed items are left off unless asked
   * for by name.
   */
  includeDisposed?: boolean;
};

export async function inventoryItemIdsForFilter(
  supabase: SupabaseClient,
  userId: string,
  filter: ShareFilter,
): Promise<string[]> {
  // `!inner` on each optional join, so a filter that matches nothing returns
  // nothing rather than everything -- the failure mode that would put the
  // whole inventory in front of someone.
  const parts = ['id'];
  if (filter.categorySlug) parts.push('categories!inner ( slug )');
  if (filter.tagSlug) parts.push('inventory_item_tags!inner ( item_tags!inner ( slug ) )');
  if (filter.listId) parts.push('inventory_item_lists!inner ( list_id )');
  if (filter.merchantId) parts.push('order_items!inner ( orders!inner ( merchant_id ) )');
  if (filter.gamesOnly) parts.push('game_details!inner ( inventory_item_id )');

  // A fresh query each time rather than one variable: a `q` is matched by two
  // reads below, and both of them start from these same conditions.
  const matching = () => {
    let query = supabase
      .from('inventory_items')
      .select(parts.join(', '))
      .eq('user_id', userId);

    if (!filter.includeDisposed) query = query.eq('status', 'owned');
    if (filter.categorySlug) query = query.eq('categories.slug', filter.categorySlug);
    if (filter.tagSlug) query = query.eq('inventory_item_tags.item_tags.slug', filter.tagSlug);
    if (filter.listId) query = query.eq('inventory_item_lists.list_id', filter.listId);
    if (filter.merchantId) {
      query = query.eq('order_items.orders.merchant_id', filter.merchantId);
    }

    return query;
  };

  // One read per column rather than an `or` over both. PostgREST reads a comma
  // inside an `or` expression as the separator between its two sides, so a `q`
  // with a comma in it sent a filter that does not parse and the picker came
  // back empty. `.ilike()` sends the pattern as its own parameter, where a
  // comma is ordinary text.
  const term = filter.q ? `%${filter.q.replace(/[%_]/g, (c) => `\\${c}`)}%` : null;
  const reads = term
    ? [matching().ilike('name', term), matching().ilike('short_name', term)]
    : [matching()];

  // The select list is assembled at runtime, so supabase-js cannot infer a row
  // type for it -- hence the cast, which is narrowed to the one column every
  // branch of that list starts with.
  const rows: Array<{ id: string }> = [];
  for (const { data, error } of await Promise.all(reads)) {
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as Array<{ id: string }>));
  }

  // A join can repeat a row -- two matching tags, two order lines -- and an
  // item whose name and short name both match the `q` comes back from both
  // reads above. The share wants one entry per unit, and adding is idempotent
  // anyway, but deduping here keeps the "added N of M" count honest.
  return [...new Set(rows.map((row) => row.id))];
}
