import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runYouTubeLibraryTick } from '@/inngest/learn/youtube-library';

// The run budgets itself to 270 seconds (inngest/learn/youtube-library.ts),
// so the handler has to outlive it.
export const maxDuration = 300;

/**
 * The YouTube library's scheduled run.
 *
 * Re-lists every followed channel, fetches queued transcripts within this
 * run's share of the month's TranscriptAPI credits, and embeds the new
 * segments. Fired four times a day by pg_cron
 * (supabase/migrations/0101_youtube_library_tick_cron.sql). Authorised with
 * `Authorization: Bearer $CRON_SECRET` like the other cron routes, because a
 * call spends credits.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runYouTubeLibraryTick()) });
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
