import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { runSubjectPlacement } from '@/inngest/learn/subject-placement';
import { recordSpend } from '@/lib/core/spend/record';
import { findChatLinks } from '@/lib/learn/chat/readings';
import { PLACEMENT_BUDGET_MS, runThemePlacementTick } from '@/inngest/learn/theme-placement';

// A call places themes and then subjects for PLACEMENT_BUDGET_MS (just under
// four minutes) between them and then stops, so the handler has to outlive it.
export const maxDuration = 300;

/**
 * Theme placement's clock tick (docs/LEARN-AREAS-SPEC.md, "Placement").
 *
 * Places every vault theme that has no field yet, then every Learn subject
 * not placed yet with the time the themes left (plan #1806). Called hourly by a pg_cron
 * job through pg_net (supabase/migrations/0097_theme_placement_tick_cron.sql),
 * because Vercel's free plan allows one cron a day. When every theme is
 * placed a call costs two reads.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a call with themes to place spends model budget.
 * Then, with what is left, it looks up where to read any reading added from
 * a chat whose lookup did not run after the reply (plan #1810). The sweeps
 * report apart: `themes`, `subjects` and `links`.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const started = Date.now();
    const themes = await runThemePlacementTick();
    const subjects = await runSubjectPlacement(started + PLACEMENT_BUDGET_MS);
    const core = createCoreServiceSupabase();
    const links = await findChatLinks(createLearnServiceSupabase(), {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      deadline: started + PLACEMENT_BUDGET_MS,
      limit: 30,
      onSpend: async (userId, reports) => {
        for (const report of reports) {
          await recordSpend(core, userId, {
            module: 'learn',
            operation: 'resolve-reference',
            model: report.model,
            usage: report.usage,
          });
        }
      },
    });
    return NextResponse.json({ ok: true, ...themes, themes, subjects, links });
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
