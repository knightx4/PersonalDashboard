import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runDashQualityCheck } from '@/inngest/core/dash-quality';

// A monthly run asks each case as a full Ask Dash answer, three at a time.
export const maxDuration = 300;

const TRIGGERS = new Set(['health', 'monthly', 'manual']);

/** A case id as run_dash_quality(case) sends it; anything else is ignored. */
const CASE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The Dash quality check (lib/dash/quality/run.ts).
 *
 * `?trigger=health`, daily from pg_cron: reads the last day of real answers
 * and asks nothing, so it spends nothing. `?trigger=monthly`, on the 1st:
 * asks every active case in core.dash_eval_cases as well. `?trigger=manual`
 * from `select core.run_dash_quality(case)`: every case, or the one `case`
 * names (supabase/migrations/0277, 0279). A trigger it does not know runs
 * the free health read. The run is kept in core.dash_eval_runs, and anything
 * failed writes a Dev note. GET and POST both.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a monthly or manual run spends model budget.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const asked = request.nextUrl.searchParams.get('trigger') ?? '';
  const trigger = (TRIGGERS.has(asked) ? asked : 'health') as 'health' | 'monthly' | 'manual';
  const only = request.nextUrl.searchParams.get('case');
  try {
    return NextResponse.json({
      ok: true,
      ...(await runDashQualityCheck(trigger, trigger === 'manual' && only && CASE_ID.test(only) ? only : null)),
    });
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
