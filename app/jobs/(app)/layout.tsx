import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import type { NavSection } from '@/components/shell/app-shell';
import { loadJobsBrief } from '@/lib/shell/brief';
import { shellFor } from '@/lib/shell/shell-for';
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

  /**
   * Now and Inbox first, as in every workspace (plan #1937.6). Today took in
   * Interviews (plan #1591) and is now the Now; its page keeps its address.
   * Review's entry is the Inbox, which carries the review count and lists the
   * queue as a row, so /jobs/review keeps its address and lights the Inbox.
   * Activity left for Today once and came back as a tab at the person's ask,
   * since "See all" at the foot of Today was too far down to find.
   */
  const sections = async (): Promise<NavSection[]> => [
    { href: '/jobs', label: 'Now', icon: 'jobsHome', exact: true },
    {
      href: '/jobs/inbox',
      label: 'Inbox',
      icon: 'inbox',
      alsoMatches: ['/jobs/review'],
      badge: await reviewCount,
    },
    { href: '/jobs/pipeline', label: 'Pipeline', icon: 'pipeline' },
    { href: '/jobs/activity', label: 'Activity', icon: 'activity' },
    { href: '/jobs/find', label: 'Find', icon: 'find' },
    { href: '/jobs/companies', label: 'Companies', icon: 'companies' },
    { href: '/jobs/contacts', label: 'Contacts', icon: 'contacts' },
    { href: '/jobs/material', label: 'Material', icon: 'answers' },
    { href: '/jobs/analytics', label: 'Analytics', icon: 'analytics' },
  ];

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
