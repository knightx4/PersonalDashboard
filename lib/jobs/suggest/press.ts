import { after } from 'next/server';
import { createClient } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSessionSpend } from '@/lib/core/spend/session';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { runWeeklyDiscovery, type WeeklyOutcome } from '@/lib/jobs/discover/weekly';
import { checkOpeningPostings } from './posting';
import { loadLatestRun, recordRuns, startRun } from './search-runs';
import { runSuggestionsFor } from './run';
import { scoreOpeningsFor } from './score-run';

/**
 * The Find page's three search presses as plain functions (plan #2228.3):
 * Find startups, the people to meet and Search now on Recommended roles. The
 * server actions (app/jobs/(app)/find/actions.ts, find/recommend-actions.ts)
 * and Dash's paid tools (lib/dash/paid-tools-jobs.ts) both call them, so a
 * search Dash starts on approval writes and records the same spend. They run
 * as the signed-in person, through the cookie clients.
 */

/** Leaves the page's five minutes room to render after the run. */
const DISCOVERY_BUDGET_MS = 240_000;

export type SearchState = { error: string | null; message?: string };

/** A new shortlist from the YC and Hacker News hiring lists, scored for fit, then the job boards of what it found. */
export async function findStartupsFor(userId: string, apiKey: string): Promise<SearchState> {
  const supabase = await createClient();
  const spend: SpendReport[] = [];
  let result: WeeklyOutcome;
  try {
    result = await runWeeklyDiscovery(supabase, userId, {
      apiKey,
      fresh: true,
      deadline: Date.now() + DISCOVERY_BUDGET_MS,
      onSpend: (report) => spend.push(report),
    });
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'The startup search failed.' };
  } finally {
    // A call that was made was paid for, whether or not the run finished.
    await recordSessionSpend(userId, { module: 'jobs', operation: 'shortlist-startups' }, spend);
  }

  if (result.state === 'skipped') return { error: null, message: 'A startup search is already running. It will show here when it finishes.' };
  if (result.error) return { error: result.error };
  const kept = result.added + result.refreshed;
  return {
    error: null,
    message: `Dash kept ${kept} ${kept === 1 ? 'startup' : 'startups'}, ${result.added} of them new, and found ${result.boardsFound} more job ${result.boardsFound === 1 ? 'board' : 'boards'}.`,
  };
}

/** New people to meet, written now rather than on the cadence. `written` is how many were kept. */
export async function suggestPeopleFor(
  userId: string,
  apiKey: string,
): Promise<{ error: string | null; message?: string; written: number }> {
  const supabase = await createClient();

  let result;
  try {
    result = await runSuggestionsFor(supabase, userId, { apiKey, kinds: ['reach_out'], force: true });
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The suggestions could not be made.', written: 0 };
  }
  await recordSessionSpend(userId, { module: 'jobs', operation: 'suggest-outreach' }, result.reach_out.spend);
  if (result.reach_out.error) return { error: result.reach_out.error, written: 0 };
  if (!result.reach_out.ran) return { error: null, message: 'Write a career goals entry or add a role first.', written: 0 };
  if (result.reach_out.written === 0) return { error: null, message: 'Dash found no new people worth suggesting right now.', written: 0 };
  return { error: null, written: result.reach_out.written };
}

/** How long the run after the response may take, inside the Find page's maxDuration of 300 seconds. */
const AFTER_BUDGET_MS = 270_000;
/** The part of it the board reads and the web search may use; the rest stores what they found. */
const SEARCH_BUDGET_MS = 255_000;

/**
 * Search now on Recommended roles. Starts a run in job_search.search_runs,
 * answers at once, and does the work after the response (next/server `after`)
 * inside the page's five minutes. `runId` is the run it started, absent when
 * one was already going or could not be started.
 */
export async function startOpeningSearchFor(
  userId: string,
  apiKey: string,
): Promise<{ error: string | null; message?: string; runId?: string }> {
  const supabase = await createClient();

  const latest = await loadLatestRun(supabase, userId, 'apply');
  if (latest?.state === 'running') return { error: null, message: 'A search is already running.' };
  const runId = await startRun(supabase, userId, 'apply', 'button');
  if (!runId) return { error: 'The search could not be started.' };
  const progress = recordRuns(supabase, userId, 'button', { apply: runId });
  const began = Date.now();

  after(async () => {
    let result;
    // Roles at discovered startups are scored before they are written when
    // Jev is on, and what that costs is recorded as scoring.
    const discoveredSpend: SpendReport[] = [];
    const jev = (await jevEnabledFor(await createCoreClient(), userId))
      ? { onSpend: (report: SpendReport) => discoveredSpend.push(report) }
      : null;
    try {
      result = await runSuggestionsFor(supabase, userId, {
        apiKey,
        kinds: ['apply'],
        force: true,
        progress,
        // The search gets what is left of the page's five minutes; past this
        // it goes on as a Message Batch (lib/jobs/suggest/search-batch.ts).
        deadline: began + SEARCH_BUDGET_MS,
        jev,
      });
    } catch (error) {
      await progress.finish('apply', {
        written: 0,
        error: error instanceof Error ? error.message : 'The search could not be made.',
      });
      return;
    }
    const outcome = result.apply;
    await recordSessionSpend(userId, { module: 'jobs', operation: 'find-openings' }, outcome.spend);
    await recordSessionSpend(userId, { module: 'jobs', operation: 'score-openings' }, discoveredSpend);
    if (!outcome.ran) {
      await progress.finish('apply', { written: 0, error: 'Write a career goals entry or add a role first.' });
      return;
    }
    // Carried on as a batch: the run stays queued, and the collector stores
    // what it finds and closes it.
    if (outcome.queued) return;
    if (outcome.error || outcome.written === 0) {
      await progress.finish('apply', { written: outcome.written, error: outcome.error });
      return;
    }

    // Read and score the new roles now with what is left of the five
    // minutes; whatever does not fit is done by tomorrow's daily run.
    const left = () => AFTER_BUDGET_MS - (Date.now() - began);
    if (left() > 30_000) {
      await progress.stage('apply', 'postings', { written: outcome.written });
      await checkOpeningPostings(supabase, userId, { budgetMs: Math.min(60_000, left() - 25_000) }).catch((err) =>
        console.error('[jobs suggestions] posting check', err instanceof Error ? err.message : err),
      );
    }
    if (left() > 20_000 && (await jevEnabledFor(await createCoreClient(), userId))) {
      await progress.stage('apply', 'scoring');
      const scoreSpend: SpendReport[] = [];
      await scoreOpeningsFor(supabase, userId, { onSpend: (report) => scoreSpend.push(report), limit: 20 }).catch(
        (err) => console.error('[jobs suggestions] score', err instanceof Error ? err.message : err),
      );
      await recordSessionSpend(userId, { module: 'jobs', operation: 'score-openings' }, scoreSpend);
    }
    await progress.finish('apply', { written: outcome.written, error: null });
  });

  return { error: null, runId };
}
