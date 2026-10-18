import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runDashFinished } from '@/inngest/core/dash-finished';

// A few reads and at most one notification per person; no model is called.
export const maxDuration = 60;

/**
 * The finished-work notification (plan #2389.3).
 *
 * Called every five minutes by a pg_cron job through pg_net
 * (supabase/migrations/0260_dash_finished_cron.sql), because Vercel's free
 * plan allows one cron a day. A call sends one notification to each person
 * whose Dash has stopped and finished something since the last one, and does
 * nothing for everyone else. GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runDashFinished()) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
