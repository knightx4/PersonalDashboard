import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runSessionWaitingJob } from '@/inngest/core/session-waiting';

// A read, and at most five notifications; no model is called.
export const maxDuration = 60;

/**
 * The notification for a session waiting on the person (plan #2800.4).
 *
 * Called every minute by a pg_cron job through pg_net
 * (supabase/migrations/0293_session_waiting_push.sql). GET and POST both; the
 * body is ignored. Authorised like the other cron routes.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runSessionWaitingJob()) });
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
