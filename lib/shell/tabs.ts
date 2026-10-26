import type { NavSection } from '@/components/shell/app-shell';
import { moduleById, type ModuleId } from '@/lib/modules';

/**
 * Every workspace's tabs, written down once (plan #2208.1).
 *
 * Each workspace used to build its tab list inside its own layout, so nothing
 * outside that layout could know what tabs another workspace had: the command
 * panel offered only the tabs of the workspace you were standing in. This is
 * the one list. The layouts build their bars from it (#2208.2, #2208.3) and
 * the panel lists every workspace's tabs from it (#2208.4).
 *
 * Keyed by workspace id from lib/modules.ts, plus `home` for Home's two rooms
 * (lib/home/sections.ts). The order of each list is the order of the bar.
 *
 * Badges are not here. Each one is a count its layout reads for the request
 * (the review queue, the Inbox, Learn's queued readings), so the layout
 * attaches it by href with `withBadges`.
 */

/** A workspace with tabs: every module, and Home. */
export type TabWorkspace = ModuleId | 'home';

export type WorkspaceTab = Omit<NavSection, 'badge'> & {
  /**
   * Only the app's owner sees this tab, in a workspace everyone else may
   * have. A workspace that is the owner's alone (Dev) is marked in
   * lib/modules.ts instead, and `tabsFor` hides all of its tabs.
   */
  ownerOnly?: true;
};

export const WORKSPACE_TABS: Readonly<Record<TabWorkspace, readonly WorkspaceTab[]>> = {
  home: [
    { href: '/home', label: 'Now', icon: 'home', exact: true, alsoMatches: ['/home/week'] },
    { href: '/home/inbox', label: 'Inbox', icon: 'inbox' },
  ],
  shopping: [
    { href: '/shopping/dashboard', label: 'Now', icon: 'dashboard' },
    // The review queue keeps its address and lights the Inbox.
    { href: '/shopping/inbox', label: 'Inbox', icon: 'inbox', alsoMatches: ['/shopping/review'] },
    { href: '/shopping/orders', label: 'Orders', icon: 'orders' },
    { href: '/shopping/inventory', label: 'Inventory', icon: 'inventory' },
    { href: '/shopping/sell', label: 'Sell', icon: 'sell' },
    { href: '/shopping/returns', label: 'Returns', icon: 'returns' },
    { href: '/shopping/recurring', label: 'Recurring', icon: 'recurring' },
    { href: '/shopping/saved', label: 'Saved', icon: 'saved' },
    { href: '/shopping/share', label: 'Share', icon: 'share' },
  ],
  jobs: [
    { href: '/jobs', label: 'Now', icon: 'jobsHome', exact: true },
    // The review queue keeps its address and lights the Inbox.
    { href: '/jobs/inbox', label: 'Inbox', icon: 'inbox', alsoMatches: ['/jobs/review'] },
    { href: '/jobs/pipeline', label: 'Pipeline', icon: 'pipeline' },
    // Who to tell about each application, and the note to them.
    { href: '/jobs/follow-ups', label: 'Follow-ups', icon: 'followUps' },
    { href: '/jobs/activity', label: 'Activity', icon: 'activity' },
    { href: '/jobs/find', label: 'Find', icon: 'find' },
    { href: '/jobs/companies', label: 'Companies', icon: 'companies' },
    { href: '/jobs/contacts', label: 'Contacts', icon: 'contacts' },
    { href: '/jobs/material', label: 'Material', icon: 'answers' },
    { href: '/jobs/analytics', label: 'Analytics', icon: 'analytics' },
  ],
  todo: [
    { href: '/todo', label: 'Now', icon: 'agenda', exact: true },
    { href: '/todo/inbox', label: 'Inbox', icon: 'inbox' },
    { href: '/todo/waiting', label: 'Waiting', icon: 'waiting' },
    { href: '/todo/calendar', label: 'Calendar', icon: 'calendar' },
    { href: '/todo/all', label: 'All', icon: 'tasks' },
  ],
  vault: [
    { href: '/vault', label: 'Now', icon: 'notes', exact: true, alsoMatches: ['/vault/n/'] },
    { href: '/vault/inbox', label: 'Inbox', icon: 'inbox' },
    // The quick notes waiting in the Inbox folder, on a tab of their own (note
    // aee95195). The Inbox also lists them as one row that opens this page.
    { href: '/vault/triage', label: 'Triage', icon: 'triage' },
    { href: '/vault/map', label: 'Map', icon: 'vaultMap' },
    { href: '/vault/maya', label: 'Maya', icon: 'maya' },
  ],
  // A subject, an idea, a quiz, an essay and a reading are reached through
  // their list, so they light its tab through `alsoMatches` rather than having
  // tabs of their own. No Goals tab (plan #1491): learning goals live on
  // /goals. Idea Space and Essays became tabs at the person's ask in October
  // 2026 (docs/CUT-BACK-SPEC.md, R1).
  learn: [
    { href: '/learn/now', label: 'Now', icon: 'readNow', exact: true },
    { href: '/learn/inbox', label: 'Inbox', icon: 'inbox', exact: true },
    {
      href: '/learn/know',
      label: 'Subjects',
      icon: 'know',
      exact: true,
      alsoMatches: ['/learn/s/', '/learn/c/', '/learn/quiz', '/learn/topics'],
    },
    { href: '/learn/space', label: 'Idea Space', icon: 'ideaSpace', exact: true },
    {
      href: '/learn/essays',
      label: 'Essays',
      icon: 'essays',
      exact: true,
      alsoMatches: ['/learn/e/'],
    },
    {
      href: '/learn/lists',
      label: 'Reading lists',
      icon: 'tracks',
      exact: true,
      alsoMatches: ['/learn/t/', '/learn/r/'],
    },
    // The owner's alone: every transcript the library fetches spends the
    // owner's TranscriptAPI credits.
    {
      href: '/learn/videos',
      label: 'Videos',
      icon: 'videos',
      exact: true,
      alsoMatches: ['/learn/videos/', '/learn/clips', '/learn/youtube'],
      ownerOnly: true,
    },
  ],
  news: [
    { href: '/news', label: 'Now', icon: 'quickRead', exact: true },
    { href: '/news/inbox', label: 'Inbox', icon: 'inbox', exact: true },
    { href: '/news/review', label: 'Daily review', icon: 'dailyReview', exact: true },
    {
      href: '/news/all',
      label: 'Newsletters',
      icon: 'newsletters',
      exact: true,
      alsoMatches: ['/news/i/'],
    },
    { href: '/news/saved', label: 'Saved', icon: 'saved', exact: true },
  ],
  goals: [
    { href: '/goals', label: 'Now', icon: 'goalsHome', exact: true },
    // Everything on you across the goals. Its count is put on by the layout.
    { href: '/goals/inbox', label: 'Inbox', icon: 'inbox' },
    { href: '/goals/all', label: 'All goals', icon: 'goalsAll' },
  ],
  you: [
    { href: '/you/personality', label: 'Personality', icon: 'personality' },
    { href: '/you/details', label: 'Details', icon: 'details' },
    { href: '/you/places', label: 'Places', icon: 'places' },
    { href: '/you/work', label: 'Work & school', icon: 'workSchool', exact: true },
    { href: '/you/insights', label: 'Insights', icon: 'insights', exact: true },
    { href: '/you/board', label: 'Board', icon: 'board' },
  ],
  // Now, then the Inbox of questions a session needs answered. Then three
  // lists: what is being built (the plan leads, as the page worked from most
  // days, note ab08d2d3), what is wrong, and what is only being thought about.
  // UI and Surfaces sit below them because they are the standard the work is
  // held to, not work. The changelog is near the end because it is looked up,
  // not worked, and Posts follows it since a post is written from it. No tab
  // per module or per outside project: each would repeat the plan's sections
  // (note 4308875b).
  dev: [
    // The route stays /dev/raised, so links already written into
    // notifications, comments and old summaries keep working.
    { href: '/dev/raised', label: 'Now', icon: 'devHome' },
    { href: '/dev/inbox', label: 'Inbox', icon: 'inbox' },
    { href: '/dev/plan', label: 'Plan', icon: 'plan' },
    { href: '/dev/bugs', label: 'Bugs and requests', icon: 'bugs' },
    { href: '/dev/ideas', label: 'Ideas', icon: 'ideas' },
    // Beside Ideas, since a takeaway is an idea someone else had (plan #1412).
    { href: '/dev/inspiration', label: 'Inspiration', icon: 'inspiration' },
    { href: '/dev/specs', label: 'Specs', icon: 'specs' },
    { href: '/dev/modules', label: 'Modules', icon: 'modules' },
    { href: '/dev/ui', label: 'UI', icon: 'ui' },
    { href: '/dev/surfaces', label: 'Surfaces', icon: 'surfaces' },
    // Which pages are opened and what each workspace spends (plan #1482).
    { href: '/dev/usage', label: 'Usage', icon: 'usage' },
    { href: '/dev/changelog', label: 'Changelog', icon: 'changelog' },
    { href: '/dev/posts', label: 'Posts', icon: 'posts' },
  ],
};

/** Every workspace in the list, Home first, then the modules in their own order. */
export const TAB_WORKSPACES = Object.keys(WORKSPACE_TABS) as readonly TabWorkspace[];

/**
 * The tabs a workspace shows this account, in bar order.
 *
 * A non-owner gets none of an owner-only workspace's tabs and none of the
 * tabs marked owner-only. The flag is dropped from what comes back, so the
 * result is ready to hand to the shell as sections.
 */
export function tabsFor(workspace: TabWorkspace, owner: boolean): NavSection[] {
  if (workspace !== 'home' && !owner && moduleById(workspace)?.ownerOnly) return [];
  return WORKSPACE_TABS[workspace]
    .filter((tab) => owner || !tab.ownerOnly)
    .map((tab) => {
      const section: WorkspaceTab = { ...tab };
      delete section.ownerOnly;
      return section;
    });
}

/**
 * The same tabs with the layout's counts put on them, by href. A tab with no
 * count, or a count of undefined (a read that failed), has no badge.
 */
export function withBadges(
  sections: readonly NavSection[],
  badges: Readonly<Record<string, number | undefined>>,
): NavSection[] {
  return sections.map((section) =>
    badges[section.href] === undefined ? section : { ...section, badge: badges[section.href] },
  );
}
