import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runNoteConnections } from '@/inngest/vault/note-connections';

// One neighbour lookup and at most one Haiku call per person with a vault.
export const maxDuration = 120;

/**
 * The weekly connections between new and older vault notes (plan #1115).
 *
 * Called on Monday afternoons by a pg_cron job through pg_net
 * (supabase/migrations/0106_note_connections_cron.sql), because Vercel's free
 * plan allows one cron a day. GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a call with connections to describe spends model
 * budget.
 */
async function run(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runNoteConnections()) });
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
