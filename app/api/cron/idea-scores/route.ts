import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runIdeaScoresTick } from '@/inngest/vault/idea-scores';

// A call scores for IDEA_SCORES_BUDGET_MS (four minutes), so the handler has
// to outlive it.
export const maxDuration = 300;

/**
 * Scores the vault map's new and changed ideas with Jev (plan #2947.3).
 *
 * Called every ten minutes by a pg_cron job through pg_net
 * (supabase/migrations-vault/0045_idea_score_queue.sql), because Vercel's
 * free plan allows one cron a day. GET and POST both; the body is ignored.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a call sends notes to TypeSafe and spends.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const summary = await runIdeaScoresTick();
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
