import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runNewsDigestTick } from '@/inngest/news/digest';

// A call starts no issue after NEWS_DIGEST_BUDGET_MS (200 seconds), and the
// last one it started can take about forty more.
export const maxDuration = 300;

/**
 * The newsletter catch-up (plan #787).
 *
 * Summarises up to ten issues that have no summary yet, oldest first, across
 * every account, and with any room left redoes issues summarised without a
 * one-line summary. Fired hourly by pg_cron
 * (supabase/migrations/0100_news_digest_tick_cron.sql); when nothing is
 * pending a call is one query and no model call. Authorised like the other
 * cron routes, with `Authorization: Bearer $CRON_SECRET`, because every call
 * can spend model budget.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runNewsDigestTick()) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return tick(request);
}

export async function POST(request: NextRequest) {
  return tick(request);
}
