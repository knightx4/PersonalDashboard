import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runYearReviews } from '@/inngest/core/year-review';

// One year of the timeline and at most one Sonnet call per person.
export const maxDuration = 120;

/**
 * The year in review, for the year just gone (plan #1121).
 *
 * Called on 2 January by a pg_cron job through pg_net
 * (supabase/migrations/0112_year_reviews.sql), because Vercel's free plan
 * allows one cron a day. GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a run spends model budget.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runYearReviews()) });
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
