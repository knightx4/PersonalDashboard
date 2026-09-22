import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runMapSweepTick } from '@/inngest/vault/map-sweep';

// A call works a sweep for SWEEP_BUDGET_MS (four minutes) and then saves where
// it stopped, so the handler has to outlive it.
export const maxDuration = 300;

/**
 * The map sweep's clock tick (plan #757).
 *
 * Called every five minutes by a pg_cron job through pg_net
 * (supabase/migrations/0094_map_sweep_tick_cron.sql), because Vercel's free
 * plan allows one cron a day. GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`. Without it anybody who knew the URL could spend the
 * account's model budget.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runMapSweepTick()) });
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
