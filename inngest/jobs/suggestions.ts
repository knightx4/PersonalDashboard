import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { pushPorts } from '@/inngest/core/day-brief';
import { createServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { loadAccountSettings, moduleEnabled } from '@/lib/core/account/settings';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpendReports } from '@/lib/core/spend/record';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { suggestionsPayload } from '@/lib/jobs/suggest/notify';
import { runSuggestionsFor } from '@/lib/jobs/suggest/run';
import { checkOpeningPostings } from '@/lib/jobs/suggest/posting';
import { recordRuns } from '@/lib/jobs/suggest/search-runs';
import { scoreApplicationsFor, scoreOpeningsFor } from '@/lib/jobs/suggest/score-run';
import { sendToPerson } from '@/lib/push/send';

/**
 * Dash's job search suggestions, called daily by pg_cron through
 * /api/cron/job-suggestions (supabase/migrations/0117_job_suggestions_tick_cron.sql).
 *
 * Works every account with the job search switched on. Whether each kind is
 * due is decided per person (lib/jobs/suggest/cadence.ts), so most days most
 * accounts cost nothing. One person's failure is noted and the rest go on.
 *
 * Each search that runs is logged in job_search.search_runs with its stage,
 * so Roles can say how the last one went (lib/jobs/suggest/search-runs.ts).
 *
 * Reading the postings and scoring them is a separate daily call
 * (runOpeningUpkeep below, /api/cron/job-openings): the searches alone can
 * take most of a request's five minutes, and one cut off there saves
 * nothing.
 *
 * A run that wrote something is sent as a phone notification to every browser
 * the person switched notifications on for (core.push_subscriptions), the
 * same way the morning brief is.
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
      const progress = recordRuns(jobs, userId, 'daily');
      const result = await runSuggestionsFor(jobs, userId, { apiKey, kinds: ['reach_out', 'apply'], now, progress });
      for (const kind of ['reach_out', 'apply'] as const) {
        const outcome = result[kind];
        if (outcome.ran) await progress.finish(kind, { written: outcome.written, error: outcome.error });
      }
      await recordSpendReports(core, userId, { module: 'jobs', operation: 'suggest-outreach' }, result.reach_out.spend);
      await recordSpendReports(core, userId, { module: 'jobs', operation: 'find-openings' }, result.apply.spend);
      summary.reachOut += result.reach_out.written;
      summary.apply += result.apply.written;
      for (const outcome of [result.reach_out, result.apply]) {
        if (outcome.error) summary.failed.push(outcome.error);
      }

      const payload = suggestionsPayload(
        { people: result.reach_out.headlines, roles: result.apply.headlines },
        now.toISOString().slice(0, 10),
      );
      const push = payload ? pushPorts(core, userId) : null;
      if (payload && push) {
        // A notification that fails is not a failed run; the suggestions are
        // on the page either way.
        await sendToPerson(push, userId, payload, now).catch((err) =>
          console.error('[jobs suggestions] push', err instanceof Error ? err.message : err),
        );
      }
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}

export type OpeningUpkeepSummary = { people: number; read: number; closed: number; scored: number; failed: string[] };

/** Everything the upkeep may take, inside its route's five minutes. */
const UPKEEP_BUDGET_MS = 250_000;

/**
 * The daily upkeep of what the searches found, called by pg_cron through
 * /api/cron/job-openings (supabase/migrations/0132_job_openings_cron.sql).
 *
 * For every account with the job search on: read each open opening not read
 * in three days from its link (lib/jobs/suggest/posting.ts), which takes a
 * closed posting off the list and gives Jev the posting's text; then, for
 * accounts that agreed to send text to TypeSafe, score the open openings not
 * yet scored (plan #1178), including ones a goals run wrote, and the open
 * applications not yet scored or whose role changed (plan #1203). What does
 * not fit in the time is left for the next day.
 */
export async function runOpeningUpkeep(now: Date = new Date()): Promise<OpeningUpkeepSummary> {
  const core = createCoreServiceSupabase();
  const jobs = createServiceSupabase();
  const { data, error } = await core.from('account_settings').select('user_id');
  if (error) throw new Error(`Reading the accounts failed: ${error.message}`);

  const began = Date.now();
  const left = () => UPKEEP_BUDGET_MS - (Date.now() - began);
  const summary: OpeningUpkeepSummary = { people: 0, read: 0, closed: 0, scored: 0, failed: [] };
  for (const { user_id: userId } of (data ?? []) as { user_id: string }[]) {
    if (left() < 30_000) break;
    try {
      if (!moduleEnabled(await loadAccountSettings(userId, core), 'jobs')) continue;
      summary.people += 1;
      const checked = await checkOpeningPostings(jobs, userId, { now, budgetMs: Math.min(90_000, left() - 60_000) });
      summary.read += checked.read;
      summary.closed += checked.closed;
      if (left() > 30_000 && (await jevEnabledFor(core, userId))) {
        const scoreSpend: SpendReport[] = [];
        const openings = await scoreOpeningsFor(jobs, userId, { onSpend: (report) => scoreSpend.push(report) });
        summary.scored += openings.scored;
        await recordSpendReports(core, userId, { module: 'jobs', operation: 'score-openings' }, scoreSpend);
        const applicationSpend: SpendReport[] = [];
        await scoreApplicationsFor(jobs, userId, { onSpend: (report) => applicationSpend.push(report) });
        await recordSpendReports(core, userId, { module: 'jobs', operation: 'score-applications' }, applicationSpend);
      }
    } catch (err) {
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
