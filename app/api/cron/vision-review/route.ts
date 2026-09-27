import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runVisionReviewTick } from '@/inngest/dev/vision-review';

export const maxDuration = 60;

/**
 * The weekly vision review tick (plan #1108).
 *
 * Fires the vision review routine once a week, unless a review was written or
 * started in the last six days. Called on Sundays by pg_cron
 * (supabase/migrations/0110_vision_review_weekly.sql), because Vercel's free
 * plan allows one cron a day. Authorised like the other cron routes, with
 * `Authorization: Bearer $CRON_SECRET`, because each fire spends the owner's
 * routine allowance.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runVisionReviewTick()) });
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
