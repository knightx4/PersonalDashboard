import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runIdeaEmbeddingsTick } from '@/inngest/learn/idea-embeddings';

// A call embeds for up to four minutes (IDEA_EMBEDDINGS_BUDGET_MS).
export const maxDuration = 300;

/**
 * The idea sweep's clock tick (plan #2147.1).
 *
 * Called every ten minutes by a pg_cron job through pg_net
 * (supabase/migrations/0248_idea_embeddings_tick_cron.sql). GET and POST both;
 * the body is ignored. Authorised with `Authorization: Bearer $CRON_SECRET`,
 * since a call spends the account's embedding budget.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runIdeaEmbeddingsTick()) });
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
