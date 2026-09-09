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
   *
   * The changelog sits below the three because it is the other direction: they
   * are what is going to happen, and it is what already did. Its lines are
   * those same lists' closed rows, so it belongs after the lists it is made of
   * rather than above them.
   *
   * UI sits below that because it is not a list of work; it is the standard
   * the work is held to, and Surfaces below that because it is where the
   * standard gets checked against the thing: every surface framed at the width
   * it is read at, with a box to say what is wrong. A note written there lands
   * in the same queue as Bugs and requests, which is the point -- one inbox,
   * not two. It lives here rather than in a document because a
   * document describing an interface goes stale the week after it is written,
   * and this one renders the real components from the real tokens: if a swatch
   * on that page is wrong, the app is wrong.
   */
  const sections: NavSection[] = [
    { href: '/dev/bugs', label: 'Bugs and requests', icon: 'bugs' },
    { href: '/dev/plan', label: 'Plan', icon: 'plan' },
    { href: '/dev/ideas', label: 'Ideas', icon: 'ideas' },
    { href: '/dev/changelog', label: 'Changelog', icon: 'changelog' },
    { href: '/dev/ui', label: 'UI', icon: 'ui' },
    { href: '/dev/surfaces', label: 'Surfaces', icon: 'surfaces' },
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
