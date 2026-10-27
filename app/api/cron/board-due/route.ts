import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runBoardDue } from '@/inngest/you/board-due';

// A few reads and at most one notification per person; no model is called.
export const maxDuration = 60;

/**
 * The daily board notification (plan #2581.10).
 *
 * Called once a day by a pg_cron job through pg_net
 * (supabase/migrations-you/0030_board_due_notices.sql), because Vercel's
 * free plan allows one cron a day. A call sends one notification to each
 * person with a decision's check-back or tripwire falling due, and records
 * what it announced. GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runBoardDue()) });
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
