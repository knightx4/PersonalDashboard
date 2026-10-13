import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import type { NavSection } from '@/components/shell/app-shell';
import { loadShoppingBrief } from '@/lib/shell/brief';
import { shellFor } from '@/lib/shell/shell-for';
import { onboardingNeeded } from '@/lib/onboarding';
import { countReviewItems } from '@/lib/review/load';

/**
 * Shell for every signed-in section.
 *
 * Middleware already blocks unauthenticated requests to this group; the check
 * here is a second line, not the first, and it is where the onboarding gate
 * runs before anything else is read.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();

  const core = await createCoreClient();

  if (await onboardingNeeded(supabase, core, user)) {
    redirect('/onboarding');
  }

  // Read once, for the Review badge and the brief both.
  const reviewCount = countReviewItems(supabase, core, user.id);
  // Awaited below; this only keeps a failure from reading as unhandled first.
  reviewCount.catch(() => {});

  return shellFor({
    module: 'shopping',
    user,
    /**
     * Review carries a count because an unattended review queue is how the
     * dashboard quietly becomes wrong. Nothing else here has earned one.
     */
    sections: async (): Promise<NavSection[]> => [
      { href: '/shopping/dashboard', label: 'Dashboard', icon: 'dashboard' },
      { href: '/shopping/orders', label: 'Orders', icon: 'orders' },
      { href: '/shopping/inventory', label: 'Inventory', icon: 'inventory' },
      { href: '/shopping/sell', label: 'Sell', icon: 'sell' },
      { href: '/shopping/returns', label: 'Returns', icon: 'returns' },
      { href: '/shopping/recurring', label: 'Recurring', icon: 'recurring' },
      { href: '/shopping/saved', label: 'Saved', icon: 'saved' },
      { href: '/shopping/share', label: 'Share', icon: 'share' },
      { href: '/shopping/review', label: 'Review', icon: 'review', badge: await reviewCount },
    ],
    settingsHref: '/shopping/settings',
    settingsLabel: 'Shopping settings',
    feedbackHref: '/dev/bugs',
    brief: async ({ settings }) => loadShoppingBrief(user.id, settings.timezone, await reviewCount),
    children,
  });
}
