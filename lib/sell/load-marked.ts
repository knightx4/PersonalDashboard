/**
 * Items the user flagged for sale by hand.
 *
 * The rest of the sell assistant starts from an identity — a confirmed ISBN or
 * BGG id — because that is what a price can be looked up against. Nothing else
 * could reach the page at all, however plainly the user wanted to sell it.
 *
 * These rows are the answer to that: pure user intent, no routing and no
 * lookup. Books and games keep their routed sections, so anything that can be
 * priced still is; this lists what is left, so the flag never means "marked,
 * and then silently dropped".
 */
import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export type SellMarkedRow = {
  inventoryItemId: string;
  name: string;
  shortName: string | null;
  imageUrl: string | null;
  categoryName: string | null;
  costCents: number;
  /** True when a routed section already covers it, so it is not listed twice. */
  routedElsewhere: boolean;
};

export async function loadMarkedForSale(input: {
  supabase: SupabaseClient;
  userId: string;
}): Promise<SellMarkedRow[]> {
  const { supabase, userId } = input;

  const { data } = await supabase
    .from('inventory_items')
    .select(
      `
      id, name, short_name, image_url, cost_cents,
      categories ( name ),
      book_details ( inventory_item_id ),
      game_details ( inventory_item_id )
    `,
    )
    .eq('user_id', userId)
    .eq('status', 'owned')
    .eq('for_sale', true)
    .order('name');

  return (data ?? []).map((row) => {
    const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
    const book = Array.isArray(row.book_details) ? row.book_details[0] : row.book_details;
    const game = Array.isArray(row.game_details) ? row.game_details[0] : row.game_details;
    return {
      inventoryItemId: row.id as string,
      name: row.name as string,
      shortName: (row.short_name as string | null) ?? null,
      imageUrl: (row.image_url as string | null) ?? null,
      categoryName: (category?.name as string | null) ?? null,
      costCents: (row.cost_cents as number | null) ?? 0,
      routedElsewhere: Boolean(book ?? game),
    };
  });
}
