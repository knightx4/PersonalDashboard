import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runStartupDiscovery } from '@/inngest/jobs/discovery';

// One Dash call and a round of board lookups, inside five minutes.
export const maxDuration = 300;

/**
 * Weekly startup discovery (plan #1684): shortlist startups from the YC and
 * Hacker News hiring lists and find their job boards.
 *
 * Called on Mondays by pg_cron through pg_net
 * (supabase/migrations/0186_startup_discovery_cron.sql), ahead of the daily
 * roles search. A week already run is recorded and not run again. GET and
 * POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a run spends model budget.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runStartupDiscovery()) });
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
