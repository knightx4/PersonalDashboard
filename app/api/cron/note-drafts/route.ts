import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runNoteDraftsTick } from '@/inngest/vault/note-drafts';

// One commit to the vault repository per due draft, at most 25.
export const maxDuration = 60;

/**
 * Commits the vault editor's drafts once they have sat ten minutes untouched.
 *
 * Called every five minutes by a pg_cron job through pg_net
 * (supabase/migrations/0274_note_drafts_cron.sql), because Vercel's free
 * plan allows one cron a day. GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a call writes to people's vaults.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const summary = await runNoteDraftsTick();
    const failed = summary.failed.length > 0;
    return NextResponse.json({ ok: !failed, ...summary }, { status: failed ? 207 : 200 });
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
