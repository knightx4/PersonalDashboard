import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runFeedTopUp } from '@/inngest/learn/feed-top-up';

// A call works for FEED_TOP_UP_BUDGET_MS (just under four minutes) and then
// stops, so the handler has to outlive it.
export const maxDuration = 300;

/**
 * The Learn now top-up (docs/LEARN-NOW-SPEC.md, "How cards are made"; plan
 * #807).
 *
 * For every account with placed themes and fewer than twenty ready cards,
 * writes picked rows in learn.feed_cards into cards, picking more sections
 * from Wikipedia first when the picked rows run out. Fired hourly by pg_cron
 * (supabase/migrations/0099_feed_top_up_tick_cron.sql). Authorised like the
 * other cron routes, with `Authorization: Bearer $CRON_SECRET`, because every
 * call spends model budget.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runFeedTopUp()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return tick(request);
}

export async function POST(request: NextRequest) {
  return tick(request);
}
