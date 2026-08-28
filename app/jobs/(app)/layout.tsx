import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadInboxBannerState } from '@/lib/core/inbox/banner';
import { TopNav } from '@/components/jobs/shell/top-nav';
import { InboxSyncBanner } from '@/components/jobs/shell/inbox-sync-banner';
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

  const [{ data: profile }, reviewCount, inbox] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', user.id).single(),
    countReviewItems(supabase, core, user.id),
    loadInboxBannerState(user.id),
  ]);

  const { accountIds, initialJob } = inbox;

  return (
    <div className="min-h-full">
      <TopNav
        displayName={profile?.display_name ?? null}
        email={user.email ?? ''}
        reviewCount={reviewCount}
      />
      <InboxSyncBanner accountIds={accountIds} initialJob={initialJob} />
      <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
