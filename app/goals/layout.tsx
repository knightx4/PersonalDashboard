import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadActivity } from '@/lib/shell/activity';
import { loadMainCheck } from '@/lib/shell/main-check';
import { switcherCounts } from '@/lib/modules/switcher-counts';

/**
 * Shell for the goals workspace (docs/GOALS-SPEC.md, plan #923).
 *
 * The proxy already blocks unauthenticated requests; the check here is a
 * second line, not the first. No onboarding gate: nothing here needs a Gmail
 * grant.
 *
 * Two tabs: the home, which is the daily view (#926), and All goals, where
 * areas and goals are added and arranged (#924). The full tree of a goal
 * opens from either (#925), so it is a deeper view rather than a tab.
 */
export default async function GoalsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const [{ data: profile }, settings, counts, activity, raised, mainCheck, owner] =
    await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', user.id).single(),
      loadAccountSettings(user.id),
      loadModuleCounts(user.id),
      loadActivity(),
      loadRaisedNotifications(user.id),
      loadMainCheck(),
      isOwner({ user }),
    ]);

  const sections: NavSection[] = [
    { href: '/goals', label: 'Home', icon: 'goalsHome', exact: true },
    { href: '/goals/all', label: 'All goals', icon: 'goalsAll' },
  ];

  return (
    <div data-workspace="goals">
      <AppShell
        account={user.id}
        module="goals"
        sections={sections}
        displayName={profile?.display_name ?? null}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        isOwner={owner}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        notifications={raised}
        activity={activity}
        mainCheck={mainCheck}
      >
        {children}
      </AppShell>
    </div>
  );
}
