import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { isOwner } from '@/lib/dev/owner';
import { NoPermission } from '@/components/shell/no-permission';
import type { NavSection } from '@/components/shell/app-shell';
import { loadDevBrief } from '@/lib/shell/brief';
import { shellFor } from '@/lib/shell/shell-for';
import { tabsFor, withBadges } from '@/lib/shell/tabs';
import { loadPlanForRequest } from '@/lib/plan/request-plan';
import { countDevInbox } from '@/lib/dev/inbox-count';

/**
 * Shell for the workspace the app keeps about itself.
 *
 * Bugs and requests used to live under Shopping, which was where the queue
 * happened to be built rather than where it belongs: a bug filed from the job
 * search is not a shopping matter, and reading the list meant standing in a
 * workspace that had nothing to do with it. It is its own place now, with the
 * ideas list beside it.
 *
 * No onboarding gate: nothing here needs a mailbox connected. Its settings
 * page holds the routines that work the repository (plan #1937.10).
 */
export default async function DevLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();

  /**
   * The gate for the whole workspace, and it is deliberately the first thing
   * after the session rather than a check on each of the seven pages.
   *
   * Before the loaders, too. Everything below this line reads the owner's
   * plan, his bug queue and his raises, and a layout that loaded them and then
   * declined to draw them would have put them in the response of a person who
   * may not see them -- the answer would be right and the page would still be
   * a leak. Nothing behind here is fetched for anybody else.
   *
   * Not the whole of the wall, though. A layout is rendered once and does not
   * re-run for every navigation beneath it, and the buttons inside these pages
   * post to server actions that can be called without rendering anything at
   * all. Those are refused in their own right -- that is #417 -- and this
   * check is what stops the workspace being drawn, not what stops it being
   * reached.
   */
  if (!(await isOwner({ user, supabase }))) {
    return <NoPermission what="The Dev workspace" />;
  }

  // Started here, beside the shell's own reads, and awaited by the Inbox tab.
  // The count is lib/dev/inbox-count.ts, which the notification that Dash has
  // finished its work reads too (plan #2389.2).
  const inbox = countDevInbox(supabase, user.id, { plan: loadPlanForRequest(user.id) });
  // A failure still fails the layout when the tab awaits it, as it did when
  // these were read in one round with the shell's; this only keeps it from
  // being reported as unhandled in the meantime.
  inbox.catch(() => {});

  return shellFor({
    module: 'dev',
    user,
    sections: async ({ owner }) => devSections(owner, await inbox),
    brief: async () => loadDevBrief(await inbox),
    // The routines that work the repository, moved off Home (plan #1937.10).
    settingsHref: '/dev/settings',
    settingsLabel: 'Dev settings',
    children,
  });
}

function devSections(owner: boolean, waiting: number): NavSection[] {
  // The tabs and their order are in lib/shell/tabs.ts (plan #2208.2), where the
  // command panel reads them too. The Inbox's badge is everything waiting on
  // you, the length of the list it opens.
  return withBadges(tabsFor('dev', owner), { '/dev/inbox': waiting });
}
