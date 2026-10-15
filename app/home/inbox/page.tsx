import { HomeInboxView } from '@/components/inbox/home-inbox';
import { moduleEnabled } from '@/lib/core/account/settings';
import { HOME_SECTIONS } from '@/lib/home/sections';
import { loadHomeInbox } from '@/lib/inbox/home-inbox';
import { shellFor } from '@/lib/shell/shell-for';

export const metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

/**
 * Everything on you, in every workspace, grouped by workspace (plan #1937.7).
 * It took the bell's place in the top bar: the bell listed the open raises
 * from every page, and this lists them with everything else whose move is
 * yours, each row with the verbs its own workspace's Inbox gives it.
 *
 * Home has no layout of its own, since its front page draws the shell with
 * its own columns, so this page draws the shell too, with Home's two rooms.
 */
export default async function HomeInboxPage() {
  return shellFor({
    module: null,
    sections: HOME_SECTIONS,
    children: async ({ user, settings, owner }) => {
      const inbox = await loadHomeInbox(user.id, {
        owner,
        enabled: (id) => moduleEnabled(settings, id),
      });
      return <HomeInboxView groups={inbox.groups} failed={inbox.failed} />;
    },
  });
}
