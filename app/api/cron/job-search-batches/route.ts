import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runSearchBatches } from '@/inngest/jobs/suggestions';

// Storing a finished search, then reading and scoring what it found, takes a few minutes.
export const maxDuration = 300;

/**
 * Finishes the Recommended roles and People to meet searches that needed
 * more time than a request allows and went on as Message Batches
 * (lib/jobs/suggest/search-batch.ts).
 *
 * Called every ten minutes by a pg_cron job through pg_net
 * (supabase/migrations/0133_job_search_batches_cron.sql). Most calls find
 * nothing queued. GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because storing a search spends model budget.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runSearchBatches()) });
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
