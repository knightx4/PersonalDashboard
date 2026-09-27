import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runDayBriefs } from '@/inngest/core/day-brief';

// The agenda read and at most one Haiku call for each person in their
// morning, after at most six Sonnet drafts written side by side (plan #1129).
export const maxDuration = 180;

/**
 * The morning brief (plan #1123).
 *
 * Called every hour by a pg_cron job through pg_net
 * (supabase/migrations/0113_day_briefs.sql), because Vercel's free plan
 * allows one cron a day and each person's six o'clock falls in a different
 * hour. A call writes the brief for everyone whose morning it is and who has
 * none for the day yet, and does nothing for everyone else. GET and POST
 * both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a run spends model budget.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runDayBriefs()) });
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
