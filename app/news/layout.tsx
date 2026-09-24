import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { estimatePaidActions, paidActionsUnder } from '@/lib/core/spend/paid-actions';
import { PaidCostsProvider } from '@/components/ui/paid-hint';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadRaisedNotifications } from '@/lib/raised/notifications';
import { loadActivity } from '@/lib/shell/activity';
import { loadMainCheck } from '@/lib/shell/main-check';
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

  const [supabase, core] = await Promise.all([createClient(), createCoreClient()]);
  const [{ data: profile }, settings, counts, activity, raised, mainCheck, owner, costs] =
    await Promise.all([
      supabase.from('profiles').select('display_name').eq('id', user.id).single(),
      loadAccountSettings(user.id),
      loadModuleCounts(user.id),
      loadActivity(),
      loadRaisedNotifications(user.id),
      loadMainCheck(),
      isOwner({ user }),
      // The $ hint on Reload in the recommended newsletters (plan #947).
      estimatePaidActions(core, user.id, paidActionsUnder('app/news/')).catch(() => ({})),
    ]);

  /**
   * Quick read first, because it is where News opens (#848). Reading an issue
   * is a deeper view of the list rather than a place of its own, so it lights
   * the Newsletters tab instead of growing one. Saved comes last (#870): it
   * is where you go back to, after reading.
   */
  const sections: NavSection[] = [
    { href: '/news', label: 'Quick read', icon: 'quickRead', exact: true },
    {
      href: '/news/all',
      label: 'Newsletters',
      icon: 'newsletters',
      exact: true,
      alsoMatches: ['/news/i/'],
    },
    { href: '/news/saved', label: 'Saved', icon: 'saved', exact: true },
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
        isOwner={owner}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        notifications={raised}
        activity={activity}
        mainCheck={mainCheck}
      >
        <PaidCostsProvider costs={costs}>{children}</PaidCostsProvider>
      </AppShell>
    </div>
  );
}
