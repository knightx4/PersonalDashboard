'use client';

import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { DELETED_OR_MOVED, NoLongerThere } from '@/components/shell/no-longer-there';
import { RouteError } from '@/components/ui/route-error';

/**
 * A workspace's not-found and error files, drawn inside the shell as the app
 * serves them (plan #1923). News stands for every workspace: each one's files
 * differ only in the name and the page the way back goes to.
 */

const newsSections: NavSection[] = [
  { href: '/news', label: 'Quick read', icon: 'quickRead', exact: true },
  { href: '/news/review', label: 'Daily review', icon: 'dailyReview', exact: true },
  { href: '/news/all', label: 'Newsletters', icon: 'newsletters', exact: true },
  { href: '/news/saved', label: 'Saved', icon: 'saved', exact: true },
];

function NewsShell({ children }: { children: React.ReactNode }) {
  return (
    <div data-workspace="news">
      <AppShell
        account="preview"
        module="news"
        sections={newsSections}
        settingsHref="/news/settings"
        settingsLabel="News settings"
        displayName="Chris"
        email="chris@example.com"
        isOwner
        counts={{ jobs: '12', shopping: '3', todo: '8' }}
        theme={{ kind: 'written', id: 'paper' }}
        brief={null}
      >
        {children}
      </AppShell>
    </div>
  );
}

/** A news issue that has been deleted, opened from an old link. */
export function RouteNotFoundSurface() {
  return (
    <NewsShell>
      <NoLongerThere
        description={DELETED_OR_MOVED}
        back={{ label: 'Back to Quick read', href: '/news' }}
      />
    </NewsShell>
  );
}

const failure = Object.assign(new Error('Preview failure'), { digest: '2817364501' });

/** A news page that threw while loading. */
export function RouteErrorSurface() {
  return (
    <NewsShell>
      <RouteError
        what="your news"
        error={failure}
        reset={() => {}}
        backHref="/news"
        backLabel="Back to Quick read"
      />
    </NewsShell>
  );
}
