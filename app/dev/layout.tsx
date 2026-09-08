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
   * Three lists, and the order is the point: what is wrong now, what was
   * decided and is being built, and what is only being thought about. A thing
   * moves up this list as it acquires commitment — an idea becomes a plan step
   * when it is decided on, and a bug is filed when something built is wrong.
   */
  const sections: NavSection[] = [
    { href: '/dev/bugs', label: 'Bugs and requests', icon: 'bugs' },
    { href: '/dev/plan', label: 'Plan', icon: 'plan' },
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
