import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The ids of the preferences the person took off /dev/ui (plan #1547,
 * `public.ui_taste_removals`). A failed read gives none, so the page shows
 * every preference rather than hiding ones that were never removed.
 */
export async function loadRemovedTaste(
  supabase: SupabaseClient,
  userId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('ui_taste_removals')
    .select('taste_id')
    .eq('user_id', userId);
  if (error) {
    console.error(`Could not read the removed preferences: ${error.message}`);
    return [];
  }
  return (data ?? []).map((row: { taste_id: string }) => row.taste_id);
}
