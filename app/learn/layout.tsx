import type { NavSection } from '@/components/shell/app-shell';
import { loadLearnBrief } from '@/lib/shell/brief';
import { shellFor } from '@/lib/shell/shell-for';
import { tabsFor, withBadges } from '@/lib/shell/tabs';
import { createLearnClient } from '@/lib/learn/auth/server';
import { countReadNow } from '@/lib/learn/tracks/load';

/**
 * Shell for the learn workspace.
 *
 * The proxy already blocks unauthenticated requests; the shell's loader
 * checks again, as a second line rather than the first.
 *
 * No onboarding gate, for the same reason the vault has none: nothing this
 * module does needs a Gmail grant, and bouncing somebody to a consent screen
 * because they pasted a reading list would be the wrong app answering.
 */
export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  return shellFor({
    module: 'learn',
    sections: async ({ owner }) =>
      learnSections(owner, await countReadNow(await createLearnClient())),
    brief: () => loadLearnBrief(),
    // What Learn offers without being asked (plan #1937.10).
    settingsHref: '/learn/settings',
    settingsLabel: 'Learn settings',
    children,
  });
}

/**
 * The tabs and their order are in lib/shell/tabs.ts (plan #2208.2), with
 * Videos marked as the owner's. The Inbox is the one badge: it counts the
 * readings you queued, not the cards Now wrote, since there are always about
 * twenty of those and a number that never goes down is not information
 * (plan #808).
 */
function learnSections(owner: boolean, readNow: number): NavSection[] {
  return withBadges(tabsFor('learn', owner), { '/learn/inbox': readNow });
}
