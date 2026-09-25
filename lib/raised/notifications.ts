import 'server-only';

import { createClient } from '@/lib/auth/server';
import type { Notification } from '@/components/shell/notifications-button';

/**
 * Open raises, as the bell reads them.
 *
 * Decision #198 put these on the shell rather than only on the dev sidebar:
 * the problem a raise exists to solve is that you have to go and look, and a
 * count you only see once you are already in /dev is the same problem one room
 * further in. So every layout that draws the shell asks for this.
 *
 * That makes it a query on every page in the app, which is why it is one
 * indexed read and why a failure returns an empty list. A shell that cannot
 * count raises still has to draw the page -- the same rule
 * lib/modules/counts.ts follows, for the same reason.
 *
 * No limit, because the bell's number is the length of this list. A cap would
 * be the difference between "eleven questions are waiting" and "at least
 * eleven", and the open rows are bounded by how many you have not answered.
 */
export async function loadRaisedNotifications(userId: string): Promise<Notification[]> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('raised_items')
      .select('id, title, detail, created_at, goal_id')
      .eq('user_id', userId)
      .eq('status', 'open')
      .order('created_at', { ascending: false });

    return (data ?? []).map((row) => ({
      id: row.id as string,
      headline: row.title as string,
      detail: (row.detail as string | null) ?? null,
      // A flag on a goal (plan #1015) is answered on the goal's page.
      href: row.goal_id ? `/goals/${row.goal_id as string}#flag-${row.id as string}` : '/dev/raised',
      at: row.created_at as string,
    }));
  } catch {
    return [];
  }
}
