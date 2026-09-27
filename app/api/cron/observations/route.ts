import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runObservations } from '@/inngest/core/observations';

// One timeline read and at most one Sonnet call per person.
export const maxDuration = 120;

/**
 * The weekly observations across the modules (plan #1119).
 *
 * Called on Monday afternoons by a pg_cron job through pg_net
 * (supabase/migrations/0111_observations.sql), because Vercel's free plan
 * allows one cron a day. GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a run spends model budget.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runObservations()) });
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
