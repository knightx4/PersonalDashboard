import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runJobSuggestions } from '@/inngest/jobs/suggestions';

// A web search run with a few rounds of searching can take a couple of minutes.
export const maxDuration = 300;

/**
 * Dash's job search suggestions: people to contact and postings to apply for.
 *
 * Called daily by a pg_cron job through pg_net
 * (supabase/migrations/0117_job_suggestions_tick_cron.sql). Each person's
 * suggestions are written only when due (lib/jobs/suggest/cadence.ts). GET and
 * POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a run spends model budget.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runJobSuggestions()) });
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
