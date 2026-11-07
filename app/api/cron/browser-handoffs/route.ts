import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runBrowserHandoffs } from '@/inngest/core/browser-wait';

// A few reads and, for a browser task that waited out its 3 minutes, one routine fire.
export const maxDuration = 60;

/**
 * The browser task sweep (plan #3040.4).
 *
 * Called every minute by a pg_cron job through pg_net
 * (supabase/migrations/0313_browser_task_wait.sql). A call lets go of claims
 * whose computer has gone quiet and starts the cloud session on each browser
 * task no computer of the person's took within 3 minutes
 * (lib/talk/browser-wait.ts). GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runBrowserHandoffs()) });
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
