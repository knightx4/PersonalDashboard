import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadActivity } from '@/lib/shell/activity';
import { switcherCounts } from '@/lib/modules/switcher-counts';

/**
 * Shell for the workspace the app keeps about itself.
 *
 * Bugs and requests used to live under Shopping, which was where the queue
 * happened to be built rather than where it belongs: a bug filed from the job
 * search is not a shopping matter, and reading the list meant standing in a
 * workspace that had nothing to do with it. It is its own place now, with the
 * ideas list beside it.
 *
 * No onboarding gate and no settings of its own: nothing here needs a mailbox
 * connected, and there is nothing about this workspace to configure.
 */
export default async function DevLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const [settings, counts, activity] = await Promise.all([
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadActivity(),
  ]);

  /**
   * Two lists, and the order is the point: what is being worked, then what is
   * only being thought about. An idea that acquires a date and a page becomes
   * a request and moves one section up by being filed as one.
   */
  const sections: NavSection[] = [
    { href: '/dev/bugs', label: 'Bugs and requests', icon: 'bugs' },
    { href: '/dev/ideas', label: 'Ideas', icon: 'ideas' },
  ];

  return (
    <div data-workspace="dev">
      <AppShell
        module="dev"
        sections={sections}
        feedbackHref="/dev/bugs"
        displayName={settings.displayName}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        activity={activity}
      >
        {children}
      </AppShell>
    </div>
  );
}
