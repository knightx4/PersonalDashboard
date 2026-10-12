/**
 * One person's weekly startup discovery (plan #1684, feature #1679): the
 * shortlist, then the job boards of what it found, with the week recorded in
 * job_search.discovery_runs.
 *
 * The record is what makes a second call in the same week harmless. A week
 * whose run finished is left alone. A week whose shortlist was written but
 * whose boards step failed repeats only the boards step, so Dash is asked
 * once a week however often the route is called. A week that failed or was
 * cut off before the shortlist was written asks again.
 *
 * The time budget is shared: the shortlist's call and the board lookups get
 * the same deadline. A shortlist that cannot finish in time writes nothing
 * (shortlist-run.ts), and boards still due after the deadline stay due, so
 * the next run picks them up (boards.ts).
 */
import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { findStartupBoards } from './boards';
import { shortlistStartups } from './shortlist-run';

/** A run still in a working stage this long after it started was cut off. */
export const STOPPED_AFTER_MINUTES = 8;

/** The Monday (UTC) of the week `now` falls in, as YYYY-MM-DD. */
export function weekStart(now: Date): string {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

export type DiscoveryRunRow = {
  stage: string;
  started_at: string;
  shortlisted_at: string | null;
};

export type Plan = 'skip' | 'shortlist' | 'boards';

/**
 * What this call should do about the week's existing row, if any.
 * `skip` when the week is done or another call is working on it.
 *
 * `fresh` is the Find startups button: the person asked for a new shortlist,
 * so a finished or failed week is run again from the start. A run still
 * working is never joined, whoever started it.
 */
export function planFor(row: DiscoveryRunRow | null, now: Date, fresh = false): Plan {
  if (!row) return 'shortlist';
  const working = row.stage !== 'failed' && row.stage !== 'done';
  const age = now.getTime() - new Date(row.started_at).getTime();
  if (working && age < STOPPED_AFTER_MINUTES * 60_000) return 'skip';
  if (fresh) return 'shortlist';
  if (row.stage === 'done') return 'skip';
  return row.shortlisted_at ? 'boards' : 'shortlist';
}

export type WeeklyOutcome = {
  /** 'skipped' when the week was already done or being worked on. */
  state: 'done' | 'failed' | 'skipped';
  shortlisted: boolean;
  added: number;
  refreshed: number;
  boardsChecked: number;
  boardsFound: number;
  boardsLeft: number;
  error: string | null;
};

export type WeeklyOptions = {
  apiKey: string;
  onSpend?: SpendSink;
  now?: Date;
  /** Epoch milliseconds by which everything must be done. */
  deadline: number;
  /** Ask Dash for a new shortlist even when this week's run has finished. */
  fresh?: boolean;
  /** Overridable for tests. */
  boards?: typeof findStartupBoards;
  shortlist?: typeof shortlistStartups;
};

async function patchRun(supabase: AppSupabaseClient, userId: string, id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('discovery_runs').update(patch).eq('id', id).eq('user_id', userId);
  if (error) throw new Error(`Recording the discovery run failed: ${error.message}`);
}

export async function runWeeklyDiscovery(
  supabase: AppSupabaseClient,
  userId: string,
  options: WeeklyOptions,
): Promise<WeeklyOutcome> {
  const now = options.now ?? new Date();
  const week = weekStart(now);
  const outcome: WeeklyOutcome = {
    state: 'done', shortlisted: false, added: 0, refreshed: 0,
    boardsChecked: 0, boardsFound: 0, boardsLeft: 0, error: null,
  };

  const found = await supabase
    .from('discovery_runs')
    .select('id, stage, started_at, shortlisted_at')
    .eq('user_id', userId)
    .eq('week_start', week)
    .maybeSingle();
  if (found.error) throw new Error(`Reading the discovery run failed: ${found.error.message}`);
  const row = found.data as (DiscoveryRunRow & { id: string }) | null;
  const plan = planFor(row, now, options.fresh);
  if (plan === 'skip') return { ...outcome, state: 'skipped' };

  let runId: string;
  if (row) {
    runId = row.id;
    await patchRun(supabase, userId, runId, {
      stage: plan === 'boards' ? 'boards' : 'reading',
      started_at: now.toISOString(),
      finished_at: null,
      error: null,
      ...(plan === 'shortlist' ? { shortlisted_at: null } : {}),
    });
  } else {
    const inserted = await supabase
      .from('discovery_runs')
      .insert({ user_id: userId, week_start: week, started_at: now.toISOString() })
      .select('id')
      .single();
    // Two calls at once: the other inserted first and is working on it.
    if (inserted.error) return { ...outcome, state: 'skipped' };
    runId = (inserted.data as { id: string }).id;
  }

  const fail = async (message: string): Promise<WeeklyOutcome> => {
    await patchRun(supabase, userId, runId, {
      stage: 'failed',
      finished_at: new Date().toISOString(),
      error: message.slice(0, 1000),
    });
    return { ...outcome, state: 'failed', error: message };
  };

  try {
    if (plan === 'shortlist') {
      await patchRun(supabase, userId, runId, { stage: 'shortlisting' });
      const result = await (options.shortlist ?? shortlistStartups)(supabase, userId, {
        apiKey: options.apiKey,
        deadline: options.deadline,
        onSpend: options.onSpend,
        now,
      });
      if (!result.ok) return await fail(result.error ?? 'The shortlist could not be made.');
      outcome.shortlisted = true;
      outcome.added = result.added;
      outcome.refreshed = result.refreshed;
      await patchRun(supabase, userId, runId, {
        stage: 'boards',
        shortlisted_at: new Date().toISOString(),
        offered: result.offered,
        added: result.added,
        refreshed: result.refreshed,
      });
    }
    const boards = await (options.boards ?? findStartupBoards)(supabase, userId, { now, deadline: options.deadline });
    outcome.boardsChecked = boards.checked;
    outcome.boardsFound = boards.found;
    outcome.boardsLeft = boards.left;
    await patchRun(supabase, userId, runId, {
      stage: 'done',
      finished_at: new Date().toISOString(),
      boards_checked: boards.checked,
      boards_found: boards.found,
      boards_left: boards.left,
    });
    return outcome;
  } catch (err) {
    return await fail(err instanceof Error ? err.message : String(err));
  }
}
