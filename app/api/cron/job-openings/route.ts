import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runOpeningUpkeep } from '@/inngest/jobs/suggestions';

// Reading every open posting and scoring the new ones takes a few minutes.
export const maxDuration = 300;

/**
 * The daily upkeep of the recommended roles: read each open posting from its
 * link, take closed ones off the list, and score what is new.
 *
 * Called daily by a pg_cron job through pg_net
 * (supabase/migrations/0132_job_openings_cron.sql), an hour and a half after
 * the searches (/api/cron/job-suggestions), so what they found is read the
 * same day. GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because scoring spends model budget.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runOpeningUpkeep()) });
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
