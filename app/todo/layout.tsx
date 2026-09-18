import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadActivity } from '@/lib/shell/activity';
import { loadMainCheck } from '@/lib/shell/main-check';
import { loadTodoBrief } from '@/lib/shell/brief';
import { switcherCounts } from '@/lib/modules/switcher-counts';

/**
 * Shell for the todo workspace.
 *
 * The proxy already blocks unauthenticated requests; the check here is a second
 * line, not the first.
 *
 * No onboarding gate, for the same reason the vault has none: neither
 * workspace's onboarding says anything about a todo list, and bouncing someone
 * to a Gmail consent screen because they wanted to write down "renew the
 * passport" would be the wrong app answering the question.
 */
export default async function TodoLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const [settings, counts, activity, raised, mainCheck, owner] = await Promise.all([
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadActivity(),
    loadRaisedNotifications(user.id),
    loadMainCheck(),
    isOwner({ user }),
  ]);

  const brief = await loadTodoBrief(user.id, settings.timezone);

  /**
   * Three questions, three sections. "Agenda" is what needs you next;
   * "Calendar" is how the month is shaped; "All" is everything, including what
   * is finished. Anything a fourth section would answer is probably a filter on
   * one of these.
   */
  const sections: NavSection[] = [
    { href: '/todo', label: 'Agenda', icon: 'agenda', exact: true },
    { href: '/todo/calendar', label: 'Calendar', icon: 'calendar' },
    { href: '/todo/all', label: 'All', icon: 'tasks' },
  ];

  return (
    <div data-workspace="todo">
      <AppShell
        account={user.id}
        module="todo"
        sections={sections}
        settingsHref="/todo/settings"
        settingsLabel="Todo settings"
        displayName={settings.displayName}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        isOwner={owner}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        notifications={raised}
        activity={activity}
        mainCheck={mainCheck}
        brief={brief}
      >
        {children}
      </AppShell>
    </div>
  );
}
