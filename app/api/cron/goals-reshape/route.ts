import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runGoalsReshape } from '@/inngest/goals/reshape';

export const maxDuration = 60;

/**
 * The goals re-shape tick (plan #1017).
 *
 * Fires the goals routine once for each goal whose questions were answered
 * at least ten minutes ago and since its last run, so the provisional steps
 * those answers held up are settled without a press. Called every ten
 * minutes by pg_cron (supabase/migrations-goals/0018_reshape_runs.sql).
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because each fire spends the owner's routine allowance.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runGoalsReshape()) });
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
