import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import type { NavSection } from '@/components/shell/app-shell';
import { loadJobsBrief } from '@/lib/shell/brief';
import { shellFor } from '@/lib/shell/shell-for';
import { tabsFor, withBadges } from '@/lib/shell/tabs';
import { onboardingNeeded } from '@/lib/jobs/onboarding';
import { countReviewItems } from '@/lib/jobs/review/load';

/**
 * Shell for every signed-in section.
 *
 * The proxy already blocks unauthenticated requests to this group; the check
 * here is a second line, not the first, and it is where the job workspace's
 * onboarding gate runs before the shell is read.
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

  // Read once, for the Inbox badge and the brief both.
  const reviewCount = countReviewItems(supabase, core, user.id);
  // Awaited below; this only keeps a failure from reading as unhandled first.
  reviewCount.catch(() => {});

  // The tabs and their order are in lib/shell/tabs.ts (plan #2208.2); the
  // Inbox carries the review count.
  const sections = async ({ owner }: { owner: boolean }): Promise<NavSection[]> =>
    withBadges(tabsFor('jobs', owner), { '/jobs/inbox': await reviewCount });

  return shellFor({
    module: 'jobs',
    user,
    sections,
    settingsHref: '/jobs/settings',
    settingsLabel: 'Job search settings',
    brief: async () => loadJobsBrief(user.id, await reviewCount),
    children,
  });
}
