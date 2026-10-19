import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runStepDone } from '@/inngest/goals/step-done-notify';

// A few reads and one notification per step closed; no model is called.
export const maxDuration = 60;

/**
 * The phone message for a flagged step Dash closed as done (plan #2376.3).
 *
 * Called every five minutes by a pg_cron job through pg_net
 * (supabase/migrations-goals/0084_step_done_cron.sql), because Vercel's free
 * plan allows one cron a day. A call sends one notification for each step
 * with notify_on_done set that Dash closed as done in the last six hours and
 * that has not been announced (inngest/goals/step-done-notify.ts). GET and
 * POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runStepDone()) });
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
