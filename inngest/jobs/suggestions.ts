import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import { recordSpendReports } from '@/lib/core/spend/record';
import { runSuggestionsFor } from '@/lib/jobs/suggest/run';

/**
 * Dash's job search suggestions, called daily by pg_cron through
 * /api/cron/job-suggestions (supabase/migrations/0117_job_suggestions_tick_cron.sql).
 *
 * Works every account with the job search switched on. Whether each kind is
 * due is decided per person (lib/jobs/suggest/cadence.ts), so most days most
 * accounts cost nothing. One person's failure is noted and the rest go on.
 */

export type JobSuggestionsSummary = {
  people: number;
  reachOut: number;
  apply: number;
  failed: string[];
};

export async function runJobSuggestions(now: Date = new Date()): Promise<JobSuggestionsSummary> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');

  const core = createCoreServiceSupabase();
  const jobs = createServiceSupabase();
  const { data, error } = await core.from('account_settings').select('user_id');
  if (error) throw new Error(`Reading the accounts failed: ${error.message}`);

  const summary: JobSuggestionsSummary = { people: 0, reachOut: 0, apply: 0, failed: [] };
  for (const { user_id: userId } of (data ?? []) as { user_id: string }[]) {
    try {
      if (!moduleEnabled(await loadAccountSettings(userId, core), 'jobs')) continue;
      summary.people += 1;
      const result = await runSuggestionsFor(jobs, userId, { apiKey, kinds: ['reach_out', 'apply'], now });
      await recordSpendReports(core, userId, { module: 'jobs', operation: 'suggest-outreach' }, result.reach_out.spend);
      await recordSpendReports(core, userId, { module: 'jobs', operation: 'find-openings' }, result.apply.spend);
      summary.reachOut += result.reach_out.written;
      summary.apply += result.apply.written;
      for (const outcome of [result.reach_out, result.apply]) {
        if (outcome.error) summary.failed.push(outcome.error);
      }
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
