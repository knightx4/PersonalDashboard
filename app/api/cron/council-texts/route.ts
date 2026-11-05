import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runCouncilTexts } from '@/inngest/you/council-texts';

// A few reads, a notification per new text, and the council tick's reads; no model is called.
export const maxDuration = 60;

/**
 * The mentors' texts on the phone (plan #2748.7).
 *
 * Called every five minutes by a pg_cron job through pg_net
 * (supabase/migrations-you/0039_council_texts.sql), because Vercel's free
 * plan allows one cron a day. A call sends one notification for each text a
 * mentor wrote unasked since the last call, outside the person's quiet
 * hours, and starts the Council's daily round once their morning begins.
 * GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runCouncilTexts()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
