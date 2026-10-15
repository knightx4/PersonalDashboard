import type { NavSection } from '@/components/shell/app-shell';

/**
 * Home's two rooms (plan #1937.7): Now, the front page, and Inbox, everything
 * on you in every workspace. Home had no sections before, so its dock was the
 * switcher alone; with these it reads Now, the switcher and Inbox, the same
 * first two rooms as every workspace (docs/ONE-INTERFACE-SPEC.md Part 1).
 *
 * No badge on the Inbox. Its count is the whole agenda, and the shell waits
 * for its sections before it draws, so a badge would hold Home's greeting
 * back for the slowest source. The count is on Home's first screen instead,
 * as a line that opens this tab, where it streams in with the rest.
 */
export const HOME_SECTIONS: readonly NavSection[] = [
  { href: '/home', label: 'Now', icon: 'home', exact: true, alsoMatches: ['/home/week'] },
  { href: '/home/inbox', label: 'Inbox', icon: 'inbox' },
];
