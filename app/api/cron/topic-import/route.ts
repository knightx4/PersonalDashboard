import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { authorizeCron } from '@/inngest/cron/authorize';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { runTopicImportTick } from '@/lib/learn/areas/topic-import';

// A call works for IMPORT_BUDGET_MS (just under four minutes) and then stops,
// so the handler has to outlive it.
export const maxDuration = 300;

const ownerSchema = z.object({ userId: z.string() });

/**
 * The Level 4 topic import (plan #2016.1): adds Wikipedia's Level 4 vital
 * articles to `learn.area_check_articles`, reads each article's other names
 * once, and embeds every title. Call it until `remaining` is zero on both
 * counts; each call picks up where the last stopped. `?refresh=1` reads the
 * list pages again and adds any article new to them, which is how the import
 * is re-run.
 *
 * Fired every ten minutes by the `topic-import-tick` job while anything is
 * left to do (supabase/migrations-learn/0127), and callable by hand with
 * `Authorization: Bearer $CRON_SECRET`, like the other cron routes.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    // The embedding spend belongs to the owner, the account the dev tooling runs as.
    const { data } = await createServiceSupabase().rpc('app_owner');
    const owner = ownerSchema.safeParse(data);
    const refresh = request.nextUrl.searchParams.get('refresh') === '1';
    const summary = await runTopicImportTick(createLearnServiceSupabase(), {
      refresh,
      payer: owner.success ? owner.data.userId : null,
    });
    return NextResponse.json({ ok: true, ...summary });
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
