import { createClient } from '@/lib/auth/server';
import { readPageOpens } from '@/lib/usage/opens';
import { readFunctionSpend, usageReport } from '@/lib/usage/report';
import { UsageScreen } from './usage-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Usage' };

/**
 * What each function spends on model calls (plan #1693), and which pages are
 * opened (plan #1482). The Dev layout has already refused anybody but the
 * owner; both reads go through the request's own client, so RLS keeps them to
 * the signed-in person.
 */
export default async function DevUsagePage() {
  const supabase = await createClient();
  const [opened, functions] = await Promise.all([readPageOpens(supabase), readFunctionSpend(supabase)]);
  return <UsageScreen report={usageReport(opened)} functions={functions} now={new Date()} />;
}
