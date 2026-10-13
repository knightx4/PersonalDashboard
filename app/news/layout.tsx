import { shellFor } from '@/lib/shell/shell-for';

/**
 * Shell for the news workspace.
 *
 * The proxy already blocks unauthenticated requests; the shell's loader
 * checks again, as a second line rather than the first.
 *
 * No onboarding gate, on the same reasoning as the vault and learn: mail
 * arrives here from an address this app owns, so nothing it does needs a Gmail
 * grant and nobody should meet a consent screen on the way in.
 *
 * The brief and the paid-cost hints come from the shell's loader.
 */
export default async function NewsLayout({ children }: { children: React.ReactNode }) {
  return shellFor({
    module: 'news',
    /**
     * Quick read first, because it is where News opens (#848). Reading an issue
     * is a deeper view of the list rather than a place of its own, so it lights
     * the Newsletters tab instead of growing one. Saved comes last (#870): it
     * is where you go back to, after reading. Daily review sits beside Quick
     * read (plan #1616): the evening's review of the same stories.
     */
    sections: [
      { href: '/news', label: 'Quick read', icon: 'quickRead', exact: true },
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
    settingsHref: '/news/settings',
    settingsLabel: 'News settings',
    children,
  });
}
