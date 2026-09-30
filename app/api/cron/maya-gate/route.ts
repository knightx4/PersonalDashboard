import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runMayaGate } from '@/inngest/vault/maya-gate';

// Jev calls on the notes that changed, then at most a few Opus thoughts; a
// thought is not started after 150 seconds (lib/vault/maya/gate-run.ts).
export const maxDuration = 300;

/**
 * Maya's hourly job (plan #1289): asks Jev about each new note version and has
 * Maya write on the few it is sure of.
 *
 * Called every hour by a pg_cron job through pg_net
 * (supabase/migrations/0131_maya_gate_cron.sql), because Vercel's free plan
 * allows one cron a day. GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a call spends Jev and model budget.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runMayaGate()) });
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
