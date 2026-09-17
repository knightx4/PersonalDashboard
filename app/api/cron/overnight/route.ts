import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runOvernightTick } from '@/inngest/dev/overnight';

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
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runOvernightTick()) });
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
