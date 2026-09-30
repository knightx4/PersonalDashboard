import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runWatchCheck } from '@/inngest/core/watches';

// Four pages read at a time, each giving up after ten seconds.
export const maxDuration = 120;

/**
 * The hourly watch check (plan #1293).
 *
 * Called every hour by a pg_cron job through pg_net
 * (supabase/migrations/0141_watches_hourly.sql). Reads every running watch,
 * stores the reading, pushes when one fires at a new low or its page has
 * failed three times running, and ends the ones past their end time
 * (lib/watch/run.ts). GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a run fetches outside pages and sends pushes.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runWatchCheck()) });
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
