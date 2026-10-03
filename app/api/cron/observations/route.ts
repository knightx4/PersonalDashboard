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
    const summary = await runObservations();
    // 207 when anyone's week failed, so the reply pg_net keeps in
    // net._http_response says so. A 200 with the failures inside it read as a
    // good run on 28 September, when the model credit ran out.
    const failed = summary.failed.length > 0;
    return NextResponse.json({ ok: !failed, ...summary }, { status: failed ? 207 : 200 });
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
