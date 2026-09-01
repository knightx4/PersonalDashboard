import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron, requestOrigin } from '@/inngest/cron/authorize';
import { runInboxIncrementalSync } from '@/inngest/cron/inbox';
import { runJobSweep } from '@/inngest/jobs/cron/sweep';
import { runJdBackfill } from '@/inngest/jobs/cron/jd-backfill';

// Long enough for the pump it starts: PUMP_BUDGET_MS is what that work is
// allowed to take, and a route that ends first takes the hand-off with it.
export const maxDuration = 300;

/**
 * Everything scheduled, behind one cron.
 *
 * One inbox sync, shared by both workspaces, then the job sweep, then the JD
 * backfill. The first two are ordered on purpose -- a message that arrived this
 * morning has to be ingested before anything is judged to have gone quiet.
 *
 * The backfill goes last because it is the only stage that talks to somebody
 * else's server, and it is the stage whose absence costs the least: a job
 * description that arrives tomorrow instead of today is a description; a sweep
 * that never runs is a pipeline that quietly stops telling the truth.
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
