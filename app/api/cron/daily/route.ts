import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron, requestOrigin } from '@/inngest/cron/authorize';
import { runInboxIncrementalSync } from '@/inngest/cron/inbox';
import { runJobSweep } from '@/inngest/jobs/cron/sweep';
import { runJdBackfill } from '@/inngest/jobs/cron/jd-backfill';
import { runVaultSyncForAll } from '@/inngest/vault/sync';
import { runClaimSweep } from '@/inngest/dev/claims';
import { runDevDigest } from '@/inngest/dev/digest';
import { runGoalsDaily } from '@/inngest/goals/daily';
import { runGoalsQuietSweep } from '@/inngest/goals/quiet-runs';
import { runGoalsWeekly } from '@/inngest/goals/weekly';

// Long enough for the pump it starts: PUMP_BUDGET_MS is what that work is
// allowed to take, and a route that ends first takes the hand-off with it.
export const maxDuration = 300;

/**
 * Everything scheduled, behind one cron.
 *
 * One inbox sync, shared by both workspaces, then the job sweep, then the JD
 * backfill, then the vault, then the dev digest. The first two are ordered on
 * purpose -- a message that arrived this morning has to be ingested before
 * anything is judged to have gone quiet.
 *
 * The next two are ordered by what their absence costs. The backfill talks to
 * somebody else's server, and a job description that arrives tomorrow instead
 * of today is still a description; a sweep that never runs is a pipeline that
 * quietly stops telling the truth. The vault comes after both: it is the
 * newest stage, and nothing reads it yet, so its freshness buys nothing today
 * and it must never be what delays a stage that does matter.
 *
 * The morning goals run (plan #933) only fires the goals routine and returns,
 * so it costs a few reads and one request. It comes before the dev stages
 * because its results are what the person opens the app for. The weekly
 * goals run (plan #934) follows it: every day it marks last week's unanswered
 * suggestions ignored, and once a week, kept by the gap since the last weekly
 * run, it fires the same routine to research city events. There is no second
 * cron for it because the Hobby plan allows one. The quiet-run sweep
 * (plan #1002) goes first of the three, so a run that died yesterday is
 * closed before the morning run reads what is still going.
 *
 * The claim sweep and the digest are both about the dev pages, and they are in
 * that order because the sweep corrects rows the digest then reports: a step
 * whose session died is put back before the summary lists what is underway.
 *
 * The digest is last because it summarises the day, and a note fixed
 * overnight should be on the morning summary of the day it was fixed rather
 * than of the day after.
 *
 * Each stage is isolated. A failure in one is reported and the rest still run,
 * because the alternative is that a broken job inbox silently stops the
 * commerce sync that has been working for months.
 */
type Stage = { name: string; run: () => Promise<unknown> };

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const origin = requestOrigin(request);
  const stages: Stage[] = [
    { name: 'inbox', run: () => runInboxIncrementalSync(origin) },
    { name: 'jobs-sweep', run: () => runJobSweep() },
    { name: 'jd-backfill', run: () => runJdBackfill() },
    { name: 'vault', run: () => runVaultSyncForAll() },
    { name: 'goals-quiet-runs', run: () => runGoalsQuietSweep() },
    { name: 'goals-daily', run: () => runGoalsDaily() },
    { name: 'goals-weekly', run: () => runGoalsWeekly() },
    { name: 'plan-claims', run: () => runClaimSweep() },
    { name: 'dev-digest', run: () => runDevDigest() },
  ];

  const results: Record<string, unknown> = {};
  const failed: string[] = [];

  for (const stage of stages) {
    try {
      results[stage.name] = await stage.run();
    } catch (err) {
      failed.push(stage.name);
      results[stage.name] = { error: err instanceof Error ? err.message : 'failed' };
    }
  }

  // 207: some stages may have failed while others did real work, and a plain
  // 500 would tell a log reader nothing about which.
  return NextResponse.json({ ok: failed.length === 0, failed, results }, {
    status: failed.length === 0 ? 200 : 207,
  });
}
