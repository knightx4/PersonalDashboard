import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runAppRoutePolls } from '@/lib/dev/app-route-polls';
import { appRoutePollPorts } from '@/lib/dev/app-route-polls-store';

// One pass calls up to three routes at once, each allowed up to 300 seconds.
export const maxDuration = 320;

/**
 * The background polls Dash and the People bots start with run_app_route
 * (plan #3070.3; lib/dev/app-route-polls.ts).
 *
 * Called every minute by a pg_cron job through pg_net
 * (supabase/migrations/0316_app_route_polls.sql). Each call takes the owner's
 * due polls, calls each route once more, and finishes the ones whose field
 * came back true, whose call failed or whose time is up: the final JSON goes
 * on the step or raise it names and a line into the chat it came from.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`. GET and POST both; the body is ignored.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runAppRoutePolls(appRoutePollPorts())) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
