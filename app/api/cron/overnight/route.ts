import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runCheckBackWake } from '@/inngest/dev/check-backs';
import { runOvernightTick } from '@/inngest/dev/overnight';
import { runGoalsQuietSweep } from '@/inngest/goals/quiet-runs';

// One tick sends one feature per account. The listing of pushes and the fire
// are two requests to somebody else's server, and neither is quick.
export const maxDuration = 60;

/**
 * The overnight runner's clock tick.
 *
 * Not a stage of /api/cron/daily: that runs once a day, and this has to run
 * every few minutes all night to notice that a session has finished and start
 * the next one. It is scheduled from the database rather than from Vercel,
 * whose Hobby plan allows one cron a day.
 *
 * GET and POST both, because the thing calling it is `pg_net` from a `pg_cron`
 * job and `net.http_post` is the call that takes headers most naturally. The
 * body is ignored either way: everything the tick needs is in the row.
 *
 * Authorised exactly like the other cron routes -- `Authorization: Bearer
 * $CRON_SECRET` -- because there is no logged-in user at three in the morning
 * and the secret is the only thing standing between this route and anybody
 * firing sessions on someone else's account.
 *
 * Each tick also closes goal runs that stopped reporting (plan #1002). This is
 * the only clock that runs every few minutes all day, which is what lets a
 * dead goal run be closed within the hour. It goes first and a failure in it
 * is reported beside the tick rather than stopping it.
 */
async function goalsQuietRuns() {
  try {
    return await runGoalsQuietSweep();
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'failed' };
  }
}

/**
 * Wakes Dash for check-backs an hour past due that no session has picked up
 * (supabase/migrations/0103). Same clock for the same reason as the sweep
 * above, and the same rule: a failure is reported beside the tick.
 */
async function checkBacks() {
  try {
    return await runCheckBackWake();
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'failed' };
  }
}

async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const goalsQuiet = await goalsQuietRuns();
  const checkBackWake = await checkBacks();
  try {
    return NextResponse.json({ ok: true, ...(await runOvernightTick()), goalsQuiet, checkBackWake });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return tick(request);
}

export async function POST(request: NextRequest) {
  return tick(request);
}
