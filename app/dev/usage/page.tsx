import { createClient } from '@/lib/auth/server';
import { readPageOpens } from '@/lib/usage/opens';
import { readWorkspaceSpend, usageReport } from '@/lib/usage/report';
import { UsageScreen } from './usage-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Usage' };

/**
 * Which pages are opened and what each workspace spends (plan #1482). The Dev
 * layout has already refused anybody but the owner; both reads go through the
 * request's own client, so RLS keeps them to the signed-in person.
 */
export default async function DevUsagePage() {
  const supabase = await createClient();
  const [opened, spend] = await Promise.all([readPageOpens(supabase), readWorkspaceSpend(supabase)]);
  return <UsageScreen report={usageReport(opened, spend)} now={new Date()} />;
}
