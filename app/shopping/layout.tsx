import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadInboxBannerState } from '@/lib/core/inbox/banner';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadActivity } from '@/lib/shell/activity';
import { loadShoppingBrief } from '@/lib/shell/brief';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { InboxSyncBanner } from '@/components/shell/inbox-sync-banner';
import { onboardingNeeded } from '@/lib/onboarding';
import { countReviewItems } from '@/lib/review/load';

/**
 * Shell for every signed-in section.
 *
 * Middleware already blocks unauthenticated requests to this group; the check
 * here is a second line, not the first, and it also gives us the profile.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();

  const core = await createCoreClient();

  if (await onboardingNeeded(supabase, core, user)) {
    redirect('/onboarding');
  }

  const [{ data: profile }, reviewCount, inbox, settings, counts, activity] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).single(),
    countReviewItems(supabase, core, user.id),
    loadInboxBannerState(user.id),
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadActivity(),
  ]);

  const brief = await loadShoppingBrief(user.id, settings.timezone, reviewCount);

  /**
   * Review carries a count because an unattended review queue is how the
   * dashboard quietly becomes wrong. Nothing else here has earned one.
   */
  const sections: NavSection[] = [
    { href: '/shopping/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { href: '/shopping/orders', label: 'Orders', icon: 'orders' },
    { href: '/shopping/inventory', label: 'Inventory', icon: 'inventory' },
    { href: '/shopping/sell', label: 'Sell', icon: 'sell' },
    { href: '/shopping/returns', label: 'Returns', icon: 'returns' },
    { href: '/shopping/saved', label: 'Saved', icon: 'saved' },
    { href: '/shopping/share', label: 'Share', icon: 'share' },
    { href: '/shopping/review', label: 'Review', icon: 'review', badge: reviewCount },
  ];

  const { accountIds, initialJob } = inbox;

  return (
    <div data-workspace="shopping">
      <AppShell
        module="shopping"
        sections={sections}
        settingsHref="/shopping/settings"
        settingsLabel="Shopping settings"
        feedbackHref="/dev/bugs"
        displayName={profile?.display_name ?? null}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        activity={activity}
        brief={brief}
        banner={<InboxSyncBanner accountIds={accountIds} initialJob={initialJob} />}
      >
        {children}
      </AppShell>
    </div>
  );
}
