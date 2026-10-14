import { createClient, getUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { readPageOpensSince, readPhoneShare } from '@/lib/usage/opens';
import { readSpendPerDay, readViewsPerDay, usageWindow } from '@/lib/usage/per-day';
import { readFunctionSpend, usageReport } from '@/lib/usage/report';
import { UsageScreen } from './usage-view';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Usage' };

/**
 * What each function spends on model calls (plan #1693), which pages are
 * opened (plan #1482), and both per day for the last 30 days (plan #2036.2).
 * Every figure is read over the same whole days in the person's timezone, so
 * the bars add up to the counts and sums beneath them. The Dev layout has
 * already refused anybody but the owner; the reads go through the request's
 * own client, so RLS keeps them to the signed-in person.
 */
export default async function DevUsagePage() {
  const supabase = await createClient();
  const user = await getUser();
  const { timezone } = user ? await loadAccountSettings(user.id) : { timezone: 'UTC' };
  const now = new Date();
  const window = usageWindow(timezone, now);
  const [opened, functions, phoneShare, views, spend] = await Promise.all([
    readPageOpensSince(supabase, window),
    readFunctionSpend(supabase, window),
    readPhoneShare(supabase, window.since),
    readViewsPerDay(supabase, timezone, window),
    readSpendPerDay(supabase, timezone, window),
  ]);
  return (
    <UsageScreen
      report={usageReport(opened)}
      functions={functions}
      phoneShare={phoneShare}
      days={{ today: window.today, span: window.span, views, spend }}
      now={now}
    />
  );
}
