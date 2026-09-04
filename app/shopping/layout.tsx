import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadInboxBannerState } from '@/lib/core/inbox/banner';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
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

  const [{ data: profile }, reviewCount, inbox, settings, counts] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).single(),
    countReviewItems(supabase, core, user.id),
    loadInboxBannerState(user.id),
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
  ]);

  /**
   * Review carries a count because an unattended review queue is how the
   * dashboard quietly becomes wrong. Nothing else here has earned one.
   */
  const sections: NavSection[] = [
    { href: '/shopping/dashboard', label: 'Dashboard' },
    { href: '/shopping/orders', label: 'Orders' },
    { href: '/shopping/inventory', label: 'Inventory' },
    { href: '/shopping/sell', label: 'Sell' },
    { href: '/shopping/returns', label: 'Returns' },
    { href: '/shopping/saved', label: 'Saved' },
    { href: '/shopping/share', label: 'Share' },
    { href: '/shopping/review', label: 'Review', badge: reviewCount },
  ];

  const { accountIds, initialJob } = inbox;

  return (
    <div data-workspace="shopping">
      <AppShell
        module="shopping"
        sections={sections}
        settingsHref="/shopping/settings"
        settingsLabel="Shopping settings"
        feedbackHref="/shopping/feedback"
        displayName={profile?.display_name ?? null}
        email={user.email ?? ''}
        enabledModules={settings.enabledModules}
        counts={switcherCounts(counts)}
        theme={settings.theme}
        banner={<InboxSyncBanner accountIds={accountIds} initialJob={initialJob} />}
      >
        {children}
      </AppShell>
    </div>
  );
}
