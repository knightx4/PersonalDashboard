import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runWeekReviews } from '@/inngest/core/week-review';

// The week's counts and at most one Sonnet call per person.
export const maxDuration = 180;

/**
 * The weekly review (plan #1232).
 *
 * Called every hour on Sundays by a pg_cron job through pg_net
 * (supabase/migrations/0127_week_review_cron.sql), because Vercel's free plan
 * allows one cron a day and 9am in New York is 13:00 or 14:00 UTC depending
 * on daylight saving. A call writes the review of the week just gone for
 * everyone who has none yet, from 9am New York time, and does nothing
 * before then. GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a run spends model budget.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runWeekReviews()) });
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
