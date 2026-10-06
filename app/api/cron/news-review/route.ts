import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runDailyReviews } from '@/inngest/news/review';

// One Sonnet call for each person whose evening it is.
export const maxDuration = 120;

/**
 * The evening review of the day's newsletters (plan #1615).
 *
 * Called every hour by a pg_cron job through pg_net
 * (supabase/migrations/0176_news_review_cron.sql), because each person's 8pm
 * falls in a different hour. A call writes the review for everyone whose
 * evening it is and who has none for the day yet, and does nothing for
 * everyone else. GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a run spends model budget.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runDailyReviews()) });
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
