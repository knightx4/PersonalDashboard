import 'server-only';

import { createClient } from '@/lib/auth/server';

/** An open raise, as Dev's Inbox badge counts it. */
export type OpenRaise = { id: string };

/**
 * The open raises, for Dev's Inbox badge.
 *
 * Every shell read these for the bell until plan #1937.7. The bell is gone:
 * an open raise is a row in Home's Inbox and in Dev's, and only Dev's layout
 * still counts them, for its tab. A failure returns an empty list, as
 * lib/modules/counts.ts does, since a column that cannot count raises still
 * has to draw the page.
 *
 * No limit, because the badge's number is the length of this list.
 */
export async function loadOpenRaises(userId: string): Promise<OpenRaise[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('raised_items')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'open');
    return (data ?? []).map((row) => ({ id: row.id as string }));
  } catch {
    return [];
  }
}
