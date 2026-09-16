import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadActivity } from '@/lib/shell/activity';
import { switcherCounts } from '@/lib/modules/switcher-counts';

/**
 * Shell for the news workspace.
 *
 * The proxy already blocks unauthenticated requests; the check here is a
 * second line, not the first.
 *
 * No onboarding gate, on the same reasoning as the vault and learn: mail
 * arrives here from an address this app owns, so nothing it does needs a Gmail
 * grant and nobody should meet a consent screen on the way in.
 *
 * No brief either, yet. The home tile says how many issues are unread, which is
 * the whole of what there is to say before anything has been read.
 */
export default async function NewsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const [{ data: profile }, settings, counts, activity, raised] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).single(),
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadActivity(),
    loadRaisedNotifications(user.id),
  ]);

  /**
   * One section, because there is one page of content. Reading an issue is a
   * deeper view of the list rather than a place of its own, so it matches this
   * tab instead of growing one.
   */
  const sections: NavSection[] = [
    {
      href: '/news',
      label: 'Newsletters',
      icon: 'newsletters',
      exact: true,
      alsoMatches: ['/news/i/'],
    },
  ];

  return (
    <div data-workspace="news">
      <AppShell
        account={user.id}
        module="news"
        sections={sections}
        settingsHref="/news/settings"
        settingsLabel="News settings"
        displayName={profile?.display_name ?? null}
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
