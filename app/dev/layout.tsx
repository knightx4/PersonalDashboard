import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
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

  const [settings, counts, activity, raised] = await Promise.all([
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadActivity(),
    loadRaisedNotifications(user.id),
  ]);

  /**
   * Raised is first because it is the only list that is waiting on you. A
   * session writes there when it needs an answer it will not give itself, and
   * a question nobody reads is a session that guessed.
   *
   * Then three lists, and the order is the point: what is wrong now, what was
   * decided and is being built, and what is only being thought about. A thing
   * moves up this list as it acquires commitment — an idea becomes a plan step
   * when it is decided on, and a bug is filed when something built is wrong.
   *
   * UI sits below the three because it is not a list of work; it is the
   * standard the work is held to, and Surfaces below that because it is where
   * the standard gets checked against the thing: every surface framed at the width
   * it is read at, with a box to say what is wrong. A note written there lands
   * in the same queue as Bugs and requests, which is the point -- one inbox,
   * not two. It lives here rather than in a document because a
   * document describing an interface goes stale the week after it is written,
   * and this one renders the real components from the real tokens: if a swatch
   * on that page is wrong, the app is wrong.
   *
   * The changelog is last, at the bottom of the list. Everything above it is
   * something you go there to do; it is the one page you go to to look
   * something up, and its lines are the closed rows of the three lists at the
   * top. Finished work is consulted, not worked, so it sits at the end rather
   * than in the middle of the things that still want doing.
   */
  const sections: NavSection[] = [
    { href: '/dev/raised', label: 'Raised', icon: 'raised', badge: raised.length },
    { href: '/dev/bugs', label: 'Bugs and requests', icon: 'bugs' },
    { href: '/dev/plan', label: 'Plan', icon: 'plan' },
    { href: '/dev/ideas', label: 'Ideas', icon: 'ideas' },
    { href: '/dev/ui', label: 'UI', icon: 'ui' },
    { href: '/dev/surfaces', label: 'Surfaces', icon: 'surfaces' },
    { href: '/dev/changelog', label: 'Changelog', icon: 'changelog' },
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
        notifications={raised}
        activity={activity}
      >
        {children}
      </AppShell>
    </div>
  );
}
