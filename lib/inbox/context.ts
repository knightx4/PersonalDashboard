import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Category lookups the commerce extractor needs.
 *
 * Lifted out of the old sync module: fetching mail is core's job now, and
 * this is the one piece of that file the commerce linker still wants.
 */
export async function loadCategoryContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<{
  categoryIdsBySlug: Map<string, string>;
  categoryOptions: Array<{ slug: string; name: string }>;
}> {
  const { data: categoryRows } = await supabase
    .from('categories')
    .select('id, slug, name, user_id')
    .is('parent_id', null)
    .or(`user_id.is.null,user_id.eq.${userId}`);
  const categoryIdsBySlug = new Map<string, string>(
    (categoryRows ?? []).map((row) => [row.slug as string, row.id as string]),
  );
  const categoryOptions = (categoryRows ?? []).map((row) => ({
    slug: row.slug as string,
    name: row.name as string,
  }));
  return { categoryIdsBySlug, categoryOptions };
}
