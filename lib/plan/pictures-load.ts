import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { picturesByItem, type PlanPicture, type PlanPictureRow } from './pictures';

/**
 * Every plan row's pictures by the row's id, without the drawings (plan
 * pictures, migration 0189). One small read; each drawing loads when its row
 * is opened.
 */
export async function loadPlanPictures(
  supabase: SupabaseClient,
  userId: string,
): Promise<Record<string, PlanPicture[]>> {
  const { data, error } = await supabase
    .from('plan_item_pictures')
    .select('id, item_id, caption, position, created_at')
    .eq('user_id', userId);
  if (error) {
    console.error(`Could not read the plan pictures: ${error.message}`);
    return {};
  }
  return picturesByItem((data ?? []) as PlanPictureRow[]);
}
