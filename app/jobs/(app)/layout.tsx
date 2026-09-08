import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { loadInboxBannerState } from '@/lib/core/inbox/banner';
import { AppShell, type NavSection } from '@/components/shell/app-shell';
import { loadModuleCounts } from '@/lib/modules/counts';
import { loadActivity } from '@/lib/shell/activity';
import { loadJobsBrief } from '@/lib/shell/brief';
import { switcherCounts } from '@/lib/modules/switcher-counts';
import { InboxSyncBanner } from '@/components/shell/inbox-sync-banner';
import { onboardingNeeded } from '@/lib/jobs/onboarding';
import { countReviewItems } from '@/lib/jobs/review/load';

/**
 * Shell for every signed-in section.
 *
 * The proxy already blocks unauthenticated requests to this group; the check
 * here is a second line, not the first, and it is also where the profile and
 * the review count are loaded once for the whole shell.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();

  const core = await createCoreClient();

  // The job workspace's own onboarding, not the commerce one. They gate on
  // different profile rows in different schemas, so completing one says nothing
  // about the other -- and sending someone to /onboarding from here would bounce
  // them straight back, forever.
  if (await onboardingNeeded(supabase, core, user)) {
    redirect('/jobs/onboarding');
  }

  const [{ data: profile }, reviewCount, inbox, settings, counts, activity] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).single(),
    countReviewItems(supabase, core, user.id),
    loadInboxBannerState(user.id),
    loadAccountSettings(user.id),
    loadModuleCounts(user.id),
    loadActivity(),
  ]);

  const brief = await loadJobsBrief(user.id, reviewCount);

  /**
   * Ten sections is over the eight the design language allows, and grouping
   * them is a routing change rather than a nav one -- so for now the strip
   * scrolls, fades at the edge, and brings the active tab into view. See
   * docs/DESIGN-UPDATE-PLAN.md.
   */
  const sections: NavSection[] = [
    { href: '/jobs/today', label: 'This week', icon: 'week' },
    { href: '/jobs/pipeline', label: 'Pipeline', icon: 'pipeline' },
    { href: '/jobs/roles', label: 'Roles', icon: 'roles' },
    { href: '/jobs/companies', label: 'Companies', icon: 'companies' },
    { href: '/jobs/contacts', label: 'Contacts', icon: 'contacts' },
    { href: '/jobs/interviews', label: 'Interviews', icon: 'interviews' },
    { href: '/jobs/answers', label: 'Answers', icon: 'answers' },
    { href: '/jobs/analytics', label: 'Analytics', icon: 'analytics' },
    { href: '/jobs/activity', label: 'Activity', icon: 'activity' },
    { href: '/jobs/review', label: 'Review', icon: 'review', badge: reviewCount },
  ];

  const { accountIds, initialJob } = inbox;

  return (
    <div data-workspace="jobs">
      <AppShell
        module="jobs"
        sections={sections}
        settingsHref="/jobs/settings"
        settingsLabel="Job search settings"
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
