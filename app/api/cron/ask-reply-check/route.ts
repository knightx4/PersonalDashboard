import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runAskReplyCheck } from '@/inngest/core/ask-reply-check';

// One Haiku call over the week's chats, and a note.
export const maxDuration = 120;

/**
 * The weekly check of Ask Dash replies that went badly (plan #2285.3).
 *
 * Called on Mondays at 13:23 and 19:23 UTC by a pg_cron job through pg_net
 * (supabase/migrations/0255_ask_reply_check_cron.sql). Each call checks the
 * Monday-to-Sunday week just gone, New York time, for the owner, and writes
 * at most one Dev note for it; the second call of the day writes nothing
 * unless the first failed. GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a run spends model budget.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runAskReplyCheck()) });
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
