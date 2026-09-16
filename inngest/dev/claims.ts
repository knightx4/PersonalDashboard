import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { claimExpiredNote, expiredClaim } from '@/lib/plan/claims';

/**
 * Putting back the claims that nothing is working.
 *
 * A step marked `in_progress` by a session that then died goes on reading as
 * underway, and the plan is not allowed to say something that is not true. The
 * page and the send guard already read the clock beside the status so that
 * they stop calling such a row live; this is the half that writes the row, so
 * the CLI, the brief and the next session see it put back too.
 *
 * A stage of the daily cron rather than a page load. The rule it applies is
 * "nothing has touched this for two hours", which is a statement about time
 * passing and not about anybody looking, and a sweep that ran on every render
 * would be a write on a read path for no gain.
 *
 * Once a day is coarse, and known to be: the Hobby plan allows one cron run a
 * day, so a claim that dies at one o'clock is put back at noon the next day.
 * What the page shows in the meantime is already right, because it reads the
 * clock. Step #498 records the run behind each claim, and asking that run
 * whether it is alive is what makes this exact rather than a threshold.
 */

export type ClaimSweepSummary = {
  /** Steps put back to not started. */
  released: number;
  /** Their numbers, so the cron's response says which. */
  steps: number[];
};

type ClaimRow = {
  id: string;
  number: number | null;
  status: string;
  assignee: string | null;
  started_at: string | null;
  comment: string | null;
};

/**
 * Every claim in the table, judged one at a time.
 *
 * Every user's, because a claim nobody is working is wrong in the same way in
 * every account and there is nothing per-person to decide. In-progress rows
 * are a handful at any moment, so the filtering is done in
 * `lib/plan/claims.ts` where the rule is tested rather than as a cutoff in the
 * query.
 */
export async function releaseStaleClaims(
  supabase: SupabaseClient,
  now = new Date(),
): Promise<ClaimSweepSummary> {
  const { data, error } = await supabase
    .from('plan_items')
    .select('id, number, status, assignee, started_at, comment')
    .eq('status', 'in_progress')
    .limit(500);
  if (error) throw new Error(error.message);

  const steps: number[] = [];
  let released = 0;

  for (const row of (data ?? []) as ClaimRow[]) {
    const why = expiredClaim(
      { status: row.status, assignee: row.assignee, startedAt: row.started_at },
      now.getTime(),
    );
    if (!why) continue;

    const line = claimExpiredNote(why, row.started_at, now.getTime());
    const { error: writeError } = await supabase
      .from('plan_items')
      .update({
        status: 'not_started',
        comment: row.comment ? `${row.comment}\n\n${line}` : line,
      })
      .eq('id', row.id)
      // Only if nothing has moved it since it was read. A session that closed
      // its step between the select and the update must not have it reopened.
      .eq('status', 'in_progress');
    if (writeError) throw new Error(writeError.message);

    released += 1;
    if (row.number !== null) steps.push(row.number);
  }

  return { released, steps };
}

/** The cron's entry point. */
export async function runClaimSweep(now = new Date()): Promise<ClaimSweepSummary> {
  return releaseStaleClaims(createServiceSupabase(), now);
}
