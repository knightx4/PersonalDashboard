import { AppShell, type NavSection } from '@/components/shell/app-shell';
import type { ModuleId } from '@/lib/modules';

/**
 * Any surface inside the whole shell: the sidebar, the top bar and the page.
 *
 * `/preview?s=<id>&shell=<path>` draws it, with `<path>` the page the surface
 * stands for, which lights its row in the column. A posts run shoots every
 * picture this way (.claude/skills/posts), because a panel cut out of the app
 * does not show what the app is.
 *
 * Each workspace's sections are copied from its layout rather than imported,
 * because the layouts read a session and a database and this route reads
 * neither. The badges are sample numbers.
 */

type Frame = {
  sections: NavSection[];
  settingsHref?: string;
  settingsLabel?: string;
};

const FRAMES: Partial<Record<ModuleId, Frame>> = {
  shopping: {
    sections: [
      { href: '/shopping/dashboard', label: 'Dashboard', icon: 'dashboard' },
      { href: '/shopping/orders', label: 'Orders', icon: 'orders' },
      { href: '/shopping/inventory', label: 'Inventory', icon: 'inventory' },
      { href: '/shopping/sell', label: 'Sell', icon: 'sell' },
      { href: '/shopping/returns', label: 'Returns', icon: 'returns' },
      { href: '/shopping/recurring', label: 'Recurring', icon: 'recurring' },
      { href: '/shopping/saved', label: 'Saved', icon: 'saved' },
      { href: '/shopping/share', label: 'Share', icon: 'share' },
      { href: '/shopping/review', label: 'Review', icon: 'review', badge: 3 },
    ],
    settingsHref: '/shopping/settings',
    settingsLabel: 'Shopping settings',
  },
  jobs: {
    sections: [
      { href: '/jobs', label: 'Today', icon: 'jobsHome', exact: true },
      { href: '/jobs/pipeline', label: 'Pipeline', icon: 'pipeline' },
      { href: '/jobs/find', label: 'Find', icon: 'find' },
      { href: '/jobs/companies', label: 'Companies', icon: 'companies' },
      { href: '/jobs/contacts', label: 'Contacts', icon: 'contacts' },
      { href: '/jobs/material', label: 'Material', icon: 'answers' },
      { href: '/jobs/analytics', label: 'Analytics', icon: 'analytics' },
    ],
    settingsHref: '/jobs/settings',
    settingsLabel: 'Job search settings',
  },
  goals: {
    sections: [
      { href: '/goals', label: 'Home', icon: 'goalsHome', exact: true },
      { href: '/goals/inbox', label: 'Inbox', icon: 'inbox', badge: 4 },
      { href: '/goals/all', label: 'All goals', icon: 'goalsAll' },
    ],
  },
  dev: {
    sections: [
      { href: '/dev/raised', label: 'Home', icon: 'devHome' },
      { href: '/dev/inbox', label: 'Inbox', icon: 'inbox', badge: 5 },
      { href: '/dev/plan', label: 'Plan', icon: 'plan' },
      { href: '/dev/bugs', label: 'Bugs and requests', icon: 'bugs' },
      { href: '/dev/ideas', label: 'Ideas', icon: 'ideas' },
      { href: '/dev/inspiration', label: 'Inspiration', icon: 'inspiration' },
      { href: '/dev/specs', label: 'Specs', icon: 'specs' },
      { href: '/dev/modules', label: 'Modules', icon: 'modules' },
      { href: '/dev/ui', label: 'UI', icon: 'ui' },
      { href: '/dev/surfaces', label: 'Surfaces', icon: 'surfaces' },
      { href: '/dev/usage', label: 'Usage', icon: 'usage' },
      { href: '/dev/changelog', label: 'Changelog', icon: 'changelog' },
      { href: '/dev/posts', label: 'Posts', icon: 'posts' },
    ],
  },
  vault: {
    sections: [
      { href: '/vault', label: 'Notes', icon: 'notes', exact: true, alsoMatches: ['/vault/n/'] },
      { href: '/vault/map', label: 'Map', icon: 'vaultMap' },
      { href: '/vault/maya', label: 'Maya', icon: 'maya' },
      { href: '/vault/education', label: 'Education', icon: 'education' },
    ],
    settingsHref: '/vault/settings',
    settingsLabel: 'Vault settings',
  },
  news: {
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
  },
  learn: {
    sections: [
      { href: '/learn/now', label: 'Now', icon: 'readNow', exact: true, badge: 2 },
      {
        href: '/learn/know',
        label: 'Subjects',
        icon: 'know',
        exact: true,
        alsoMatches: ['/learn/s/', '/learn/c/', '/learn/quiz'],
      },
      {
        href: '/learn/lists',
        label: 'Reading lists',
        icon: 'tracks',
        exact: true,
        alsoMatches: ['/learn/t/', '/learn/r/', '/learn/new'],
      },
      {
        href: '/learn/videos',
        label: 'Videos',
        icon: 'videos',
        exact: true,
        alsoMatches: ['/learn/videos/', '/learn/clips', '/learn/youtube'],
      },
    ],
  },
  todo: {
    sections: [
      { href: '/todo', label: 'Agenda', icon: 'agenda', exact: true },
      { href: '/todo/waiting', label: 'Waiting', icon: 'waiting' },
      { href: '/todo/calendar', label: 'Calendar', icon: 'calendar' },
      { href: '/todo/all', label: 'All', icon: 'tasks' },
    ],
    settingsHref: '/todo/settings',
    settingsLabel: 'Todo settings',
  },
};

export function ShellFrame({
  module,
  path,
  children,
}: {
  module: ModuleId;
  path: string;
  children: React.ReactNode;
}) {
  const frame = FRAMES[module] ?? { sections: [] };
  return (
    <div data-workspace={module}>
      <AppShell
        account="preview"
        module={FRAMES[module] ? module : null}
        sections={frame.sections}
        settingsHref={frame.settingsHref}
        settingsLabel={frame.settingsLabel}
        feedbackHref="/dev/bugs"
        // The name the shopping fixtures already use, and nobody's real one:
        // these pictures go on X.
        displayName="Alex"
        email="alex@example.com"
        isOwner
        counts={{ jobs: '3', todo: '8', shopping: '1' }}
        theme={{ kind: 'written', id: 'paper' }}
        brief={null}
        pathname={path}
      >
        {children}
      </AppShell>
    </div>
  );
}
