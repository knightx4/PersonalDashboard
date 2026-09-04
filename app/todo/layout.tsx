import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadActivity } from '@/lib/shell/activity';
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

  const [settings, counts, activity] = await Promise.all([
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadActivity(),
  ]);

  const brief = await loadTodoBrief(user.id, settings.timezone);

  /**
   * Two sections and nothing else. "Agenda" is what needs you; "All" is
   * everything, including what is finished. A todo module that grows a third
   * section has probably grown a feature it did not need.
   */
  const sections: NavSection[] = [
    { href: '/todo', label: 'Agenda', icon: 'agenda', exact: true },
    { href: '/todo/all', label: 'All', icon: 'tasks' },
  ];

  return (
    <div data-workspace="todo">
      <AppShell
        module="todo"
        sections={sections}
        settingsHref="/todo/settings"
        settingsLabel="Todo settings"
        displayName={settings.displayName}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        activity={activity}
        brief={brief}
      >
        {children}
      </AppShell>
    </div>
  );
}
