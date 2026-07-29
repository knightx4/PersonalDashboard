import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { enrichItemDisplay } from './enrich-display';

/**
 * Fill short_name / search_tags for a user's inventory rows that still lack tags.
 * Safe to call on every inventory page load — no-ops once enriched.
 */
export async function backfillUserInventoryDisplay(
  supabase: SupabaseClient,
  userId: string,
  limit = 80,
): Promise<number> {
  const { data: rows, error } = await supabase
    .from('inventory_items')
    .select(
      `
      id, name, variant, short_name, search_tags, category_id,
      categories ( name, slug )
    `,
    )
    .eq('user_id', userId)
    .or('search_tags.eq.{},short_name.is.null')
    .limit(limit);

  if (error || !rows?.length) return 0;

  let updated = 0;
  for (const row of rows) {
    const category = Array.isArray(row.categories) ? row.categories[0] : row.categories;
    const tags = (row.search_tags as string[] | null) ?? [];
    if (tags.length > 0 && row.short_name) continue;

    const enriched = enrichItemDisplay({
      name: row.name,
      shortName: row.short_name,
      variant: row.variant,
      categorySlug: category?.slug ?? null,
      categoryName: category?.name ?? null,
      searchTags: tags,
    });

    const { error: updateError } = await supabase
      .from('inventory_items')
      .update({
        short_name: enriched.shortName,
        search_tags: enriched.searchTags,
      })
      .eq('id', row.id)
      .eq('user_id', userId);

    if (!updateError) updated += 1;
  }

  return updated;
}
