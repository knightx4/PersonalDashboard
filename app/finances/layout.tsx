import { redirect } from 'next/navigation';
import { createClient, getUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { onboardingNeeded } from '@/lib/onboarding';
import { shellFor } from '@/lib/shell/shell-for';
import { tabsFor } from '@/lib/shell/tabs';

/**
 * Shell for the Finances workspace (plan #2593): the accounts you hold and
 * where the money goes.
 *
 * Spending and Recurring moved here from Shopping in #2593.1, and their old
 * addresses redirect (next.config.ts). Both still read Shopping's tables,
 * so the onboarding gate is the one Shopping's layout runs.
 */
export default async function FinancesLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');

  if (await onboardingNeeded(await createClient(), await createCoreClient(), user)) {
    redirect('/onboarding');
  }

  return shellFor({
    module: 'finances',
    user,
    sections: ({ owner }) => tabsFor('finances', owner),
    settingsHref: '/finances/settings',
    settingsLabel: 'Finances settings',
    children,
  });
}
