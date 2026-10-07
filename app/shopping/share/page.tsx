import { createClient, requireUser } from '@/lib/auth/server';
import { SharesView } from './shares-view';

export const metadata = { title: 'Shared forms' };

/**
 * The shares I have made.
 *
 * A share is a list of things plus a link someone with no account can open.
 * The answers come back here; nothing she does changes the inventory on its
 * own. See docs/SHARE-LINKS-SPEC.md.
 */
export default async function SharesPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: shares } = await supabase
    .from('share_links')
    .select(
      `
      id, title, intro, status, created_at,
      share_link_items ( id ),
      share_link_responses ( id ),
      share_link_tokens ( id, revoked_at, last_seen_at )
    `,
    )
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  const rows = shares ?? [];

  return <SharesView rows={rows} />;
}
