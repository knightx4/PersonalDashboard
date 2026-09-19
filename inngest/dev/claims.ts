import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { claimExpiredNote, expiredClaim, type ExpiredClaim } from '@/lib/plan/claims';
import { listPushes } from '@/lib/plan/ci';
import { claimIsLive, claimLiveness, lastPushSince } from '@/lib/plan/liveness';
import { endsRun, readingFor } from '@/lib/plan/run-end';
import { subtreeBlockedAt } from '@/lib/plan/subtree';

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
 * clock.
 *
 * The clock alone is not enough to write with, though, and #571 settled what
 * to do about it: before this takes a step off a session, it asks GitHub what
 * has been pushed since that session's run was fired, and leaves the claim
 * standing while the run still reads as live. A batch that is four hours in
 * and pushed a minute ago is working, and the two-hour threshold called it
 * dead. Only the handful of claims the clock has already condemned are asked
 * about, so the cost is one request on the days there is anything to ask.
 *
 * A refusal, a rejected key or a step with nothing fired at it leaves the
 * pass exactly as it was: the reading is set aside and the two hours decide,
 * which is the fallback #570 chose. Nothing the sweep reads can condemn a
 * claim the clock has not: the reading is only ever consulted about a step
 * that is already two hours old.
 *
 * What a refusal does change is the line written on the row. #682: a claim
 * released after GitHub answered and the run had pushed nothing, and one
 * released because GitHub could not be asked at all, wrote the same sentence,
 * and only the second is a reason to go and look at the token. So the refusal
 * is carried out of the ask and into the note.
 *
 * A block can take back what the look at GitHub saved. #679 added that second
 * half of the reading: a session that stopped to ask a question has ended,
 * whatever it pushed on the way, so a claim over a subtree carrying a block
 * newer than its run goes back on this pass rather than at the next sweep.
 *
 * `refreshRunReadings` in `lib/plan/runs.ts` is the other caller of the same
 * evidence and is not reused here, because it reads the claimed steps of one
 * account and writes a reading against every one of them. This sweep is every
 * account's at once and wants the runs behind a named few, so it asks the
 * narrower question and stores nothing: the plan page refreshes the readings
 * whenever somebody looks, and a reading taken at noon on the cron's clock
 * would be stale by the time anybody read it.
 *
 * The overnight tick is the second caller, and the reason there is one: a night
 * runs while the daily cron does not, and a step left claimed by a run that
 * died holds up every feature above it until morning. It calls
 * `releaseStaleClaims` itself, before it reads the plan it chooses from.
 */

export type ClaimSweepSummary = {
  /** Steps put back to not started. */
  released: number;
  /** Their numbers, so the cron's response says which. */
  steps: number[];
  /**
   * The steps the clock condemned and GitHub saved, by number.
   *
   * Said out loud because this is the only place the new rule is visible: a
   * pass that keeps a claim looks from the outside exactly like a pass that
   * found nothing to do.
   */
  kept: number[];
};

type ClaimRow = {
  id: string;
  number: number | null;
  status: string;
  assignee: string | null;
  started_at: string | null;
  comment: string | null;
};

/** A claim the clock has condemned, and which of the two reasons it was. */
type StaleClaim = { row: ClaimRow; why: ExpiredClaim };

/** Enough of the run behind a claim to ask GitHub about it. */
type RunRow = {
  id: string;
  plan_item_id: string | null;
  status: string;
  created_at: string;
};

/**
 * What the runs behind a condemned set said, for the pass as a whole.
 *
 * Two answers rather than one because a release has two shapes now. `live` is
 * the claims that stand. `unheard` is the ones released without anything
 * having been read about them: they had a run to ask about and GitHub refused,
 * so the clock decided on its own and the line written on the row says so.
 */
type ClaimRunEvidence = {
  /** Steps whose run still reads live, so the claim stands. */
  live: Set<string>;
  /** Steps GitHub could not be asked about, against why it refused. */
  unheard: Map<string, string>;
};

/** Nothing was read, so every condemned claim goes back on the clock alone. */
function noEvidence(): ClaimRunEvidence {
  return { live: new Set(), unheard: new Map() };
}

/**
 * Which of these condemned claims have a run that is still live, by step id.
 *
 * Only the ones the clock condemned as `stale` are asked about. `unowned` is
 * not a judgement about time at all -- every path that claims a step names who
 * holds it, so a claim with no assignee is one nothing is holding whatever is
 * being pushed -- and sparing those would quietly change a second rule that
 * #571 did not ask about.
 *
 * Two reads and one request, whatever the number of claims: the runs sent at
 * those steps, and one listing of what has been pushed since the oldest of
 * them started. The runs are read without a user filter, the same as the
 * claims above them, because a claim nobody is working is wrong in the same
 * way in every account.
 *
 * `claimLiveness` is what judges, fed the listing that was just taken rather
 * than the reading stored on the row. The stored one is no use here: #570 does
 * not trust a reading older than two hours, and this pass runs at a time when
 * the last one almost always is.
 *
 * An empty set is the safe answer and is what every failure returns, since a
 * claim missing from it is released exactly as it was before.
 */
async function claimsWithLiveRuns(
  supabase: SupabaseClient,
  claims: readonly StaleClaim[],
  now: Date,
  fetchFn?: typeof globalThis.fetch,
): Promise<ClaimRunEvidence> {
  const candidates = claims.filter((claim) => claim.why === 'stale');
  if (candidates.length === 0) return noEvidence();

  const { data, error } = await supabase
    .from('plan_runs')
    .select('id, plan_item_id, status, created_at')
    .in(
      'plan_item_id',
      candidates.map((claim) => claim.row.id),
    )
    .order('created_at', { ascending: false });
  if (error) {
    // The clock decides, which is what it did before there was anything to
    // read. A sweep that refused to run because one read failed would leave
    // every dead claim standing until tomorrow.
    console.error(`the runs behind the stale claims could not be read: ${error.message}`);
    return noEvidence();
  }

  // Newest first, so the first row seen for a step is the run holding it.
  const latest = new Map<string, RunRow>();
  for (const run of (data ?? []) as RunRow[]) {
    if (run.plan_item_id && !latest.has(run.plan_item_id)) latest.set(run.plan_item_id, run);
  }
  if (latest.size === 0) return noEvidence();

  const oldest = Math.min(...[...latest.values()].map((run) => new Date(run.created_at).getTime()));
  const { pushes, error: refusal } = await listPushes({ since: oldest, fetch: fetchFn });
  const checkedAt = now.toISOString();

  const live = new Set<string>();
  const unheard = new Map<string, string>();
  for (const { row } of candidates) {
    const run = latest.get(row.id);
    if (!run) continue;

    // There was a run to ask about and GitHub would not say what it pushed.
    // The claim is released on the clock below, the same as it was before
    // #682; what is recorded here is that nothing was read, so the line on the
    // row can say the release had no evidence behind it rather than evidence
    // against it.
    if (refusal) unheard.set(row.id, refusal);

    const push = refusal ? null : lastPushSince(pushes, run.created_at);
    const reading = readingFor({
      checkedAt,
      lastPush: push ? { at: push.at, sha: push.sha, subject: null } : null,
      refusal,
    });
    const liveness = claimLiveness(
      { status: row.status, startedAt: row.started_at },
      { status: run.status, createdAt: run.created_at, reading },
      now.getTime(),
    );
    if (!claimIsLive(liveness)) continue;

    // The pushes say a session was working, and a block under this step says
    // that session has stopped: it wrote down what it needs and there is
    // nothing more coming from it. #679. So the claim goes back rather than
    // standing until the two hours are up.
    //
    // Only asked of the handful GitHub just saved, so an ordinary sweep makes
    // no extra request at all. The subtree rather than this row, because a row
    // holding a claim is never blocked itself -- the trigger clears
    // `blocked_at` on anything that is not blocked -- so what stopped is a step
    // beneath it. The newest close is deliberately not read here: a step
    // closing under a claim is a session working through a batch.
    const blockedAt = await subtreeBlockedAt(supabase, row.id);
    if (endsRun(blockedAt, run.created_at)) continue;

    live.add(row.id);
  }

  return { live, unheard };
}

/**
 * Every claim in the table, judged one at a time.
 *
 * Every user's, because a claim nobody is working is wrong in the same way in
 * every account and there is nothing per-person to decide. In-progress rows
 * are a handful at any moment, so the filtering is done in
 * `lib/plan/claims.ts` where the rule is tested rather than as a cutoff in the
 * query.
 *
 * Two passes rather than one. The clock condemns, then GitHub is asked about
 * the whole condemned set at once and whatever it saves is skipped. Judging
 * and writing row by row would be one request per claim.
 *
 * `fetch` is for the tests, the same as everywhere else that reads GitHub.
 */
export async function releaseStaleClaims(
  supabase: SupabaseClient,
  now = new Date(),
  options: { fetch?: typeof globalThis.fetch } = {},
): Promise<ClaimSweepSummary> {
  const { data, error } = await supabase
    .from('plan_items')
    .select('id, number, status, assignee, started_at, comment')
    .eq('status', 'in_progress')
    .limit(500);
  if (error) throw new Error(error.message);

  const expired: StaleClaim[] = [];
  for (const row of (data ?? []) as ClaimRow[]) {
    const why = expiredClaim(
      { status: row.status, assignee: row.assignee, startedAt: row.started_at },
      now.getTime(),
    );
    if (why) expired.push({ row, why });
  }

  // Asked once, for the whole condemned set, before anything is written.
  const { live, unheard } = await claimsWithLiveRuns(supabase, expired, now, options.fetch);

  const steps: number[] = [];
  const kept: number[] = [];
  let released = 0;

  for (const { row, why } of expired) {
    if (live.has(row.id)) {
      if (row.number !== null) kept.push(row.number);
      continue;
    }

    const line = claimExpiredNote(why, row.started_at, now.getTime(), unheard.get(row.id) ?? null);
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

  return { released, steps, kept };
}

/** The cron's entry point. */
export async function runClaimSweep(now = new Date()): Promise<ClaimSweepSummary> {
  return releaseStaleClaims(createServiceSupabase(), now);
}
