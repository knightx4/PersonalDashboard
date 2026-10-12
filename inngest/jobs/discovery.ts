import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import { runWeeklyDiscovery } from '@/lib/jobs/discover/weekly';

/**
 * Weekly startup discovery (plan #1684), called by pg_cron through
 * /api/cron/startup-discovery (supabase/migrations/0186_startup_discovery_cron.sql).
 *
 * For every account with the job search on: Dash shortlists startups from the
 * YC and Hacker News hiring lists, then the job boards of what it found are
 * looked for (lib/jobs/discover/weekly.ts). Each account's week is recorded in
 * job_search.discovery_runs, so a repeated call in the same week asks Dash
 * nothing. One person's failure is noted and the rest go on.
 */

export type StartupDiscoverySummary = {
  people: number;
  skipped: number;
  added: number;
  refreshed: number;
  boardsFound: number;
  failed: string[];
};

/** Everything the run may take, inside its route's five minutes. */
const BUDGET_MS = 270_000;
/** Less than this and another account's shortlist would not get its call. */
const MIN_ACCOUNT_MS = 75_000;

export async function runStartupDiscovery(now: Date = new Date()): Promise<StartupDiscoverySummary> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');

  const core = createCoreServiceSupabase();
  const jobs = createServiceSupabase();
  const { data, error } = await core.from('account_settings').select('user_id');
  if (error) throw new Error(`Reading the accounts failed: ${error.message}`);

  const deadline = Date.now() + BUDGET_MS;
  const summary: StartupDiscoverySummary = { people: 0, skipped: 0, added: 0, refreshed: 0, boardsFound: 0, failed: [] };
  for (const { user_id: userId } of (data ?? []) as { user_id: string }[]) {
    if (deadline - Date.now() < MIN_ACCOUNT_MS) break;
    try {
      if (!moduleEnabled(await loadAccountSettings(userId, core), 'jobs')) continue;
      summary.people += 1;
      const spend: SpendReport[] = [];
      const result = await runWeeklyDiscovery(jobs, userId, {
        apiKey,
        now,
        deadline,
        onSpend: (report) => spend.push(report),
      });
      // Recorded whether or not the run went on to succeed: a call that was
      // made was paid for.
      await recordSpendReports(core, userId, { module: 'jobs', operation: 'shortlist-startups' }, spend);
      if (result.state === 'skipped') summary.skipped += 1;
      summary.added += result.added;
      summary.refreshed += result.refreshed;
      summary.boardsFound += result.boardsFound;
      if (result.error) summary.failed.push(result.error);
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
