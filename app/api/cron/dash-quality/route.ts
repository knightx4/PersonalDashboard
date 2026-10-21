import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runDashQualityCheck } from '@/inngest/core/dash-quality';

// Each case is a full Ask Dash answer, three at a time.
export const maxDuration = 300;

/**
 * The nightly Dash quality check (lib/dash/quality/run.ts).
 *
 * Called at 07:17 UTC by a pg_cron job through pg_net, and on demand by
 * `select core.run_dash_quality()` (supabase/migrations/0277). Asks every
 * active case in core.dash_eval_cases of the owner's, grades the answers,
 * works out the last day of real answers, keeps the run in
 * core.dash_eval_runs and writes a Dev note when anything failed.
 * `?trigger=manual` marks a run started by hand. GET and POST both.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a run spends model budget.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const trigger = request.nextUrl.searchParams.get('trigger') === 'manual' ? 'manual' : 'nightly';
  try {
    return NextResponse.json({ ok: true, ...(await runDashQualityCheck(trigger)) });
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
