import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShareOption } from '@/components/share/send-to-share';

/** The active shares, for the "send to form" picker. Archived ones are not offered. */
export async function loadShareOptions(
  supabase: SupabaseClient,
  userId: string,
): Promise<ShareOption[]> {
  const { data } = await supabase
    .from('share_links')
    .select('id, title')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  return (data ?? []).map((row) => ({ id: row.id as string, title: row.title as string }));
}
