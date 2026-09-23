import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runThemePlacementTick } from '@/inngest/learn/theme-placement';

// A call places themes for PLACEMENT_BUDGET_MS (just under four minutes) and
// then stops, so the handler has to outlive it.
export const maxDuration = 300;

/**
 * Theme placement's clock tick (docs/LEARN-AREAS-SPEC.md, "Placement").
 *
 * Places every vault theme that has no field yet. Called hourly by a pg_cron
 * job through pg_net (supabase/migrations/0097_theme_placement_tick_cron.sql),
 * because Vercel's free plan allows one cron a day. When every theme is
 * placed a call costs two reads.
 *
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because a call with themes to place spends model budget.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runThemePlacementTick()) });
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
