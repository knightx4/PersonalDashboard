import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { recordSpend } from '@/lib/core/spend/record';
import { checkInspirationForEveryone } from '@/lib/dev/inspiration/check';

// The run stops starting new work at 270 seconds, so the handler outlives it.
export const maxDuration = 300;
const BUDGET_MS = 270_000;

/**
 * The Inspiration tab's daily check (plan #1411).
 *
 * Reads every inspiration playlist, fetches the new videos' transcripts, reads
 * each new video for takeaways and merges them with the ones already found
 * (lib/dev/inspiration/check.ts). Fired once a day by pg_cron
 * (supabase/migrations/0145_inspiration_check.sql). Authorised with
 * `Authorization: Bearer $CRON_SECRET` like the other cron routes, because a
 * call spends credits.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const core = createCoreServiceSupabase();
    const spend: Promise<unknown>[] = [];
    const results = await checkInspirationForEveryone(createLearnServiceSupabase(), {
      trigger: 'scheduled',
      anthropicApiKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
      deadline: Date.now() + BUDGET_MS,
      onSpend: (userId, report, operation) =>
        void spend.push(recordSpend(core, userId, { module: 'core', operation, model: report.model, usage: report.usage })),
    });
    await Promise.all(spend);
    return NextResponse.json({ ok: true, results });
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
