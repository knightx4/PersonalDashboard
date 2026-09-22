import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runAreaCheckTick } from '@/inngest/learn/area-check';

// A call places articles for CHECK_BUDGET_MS (just under four minutes) and then
// stops, so the handler has to outlive it.
export const maxDuration = 300;

/**
 * The areas check (docs/LEARN-AREAS-SPEC.md): places Wikipedia's Level 3 vital
 * articles into the areas and writes each placement to
 * `learn.area_check_articles`. Call it until `remaining` is 0; each call picks
 * up where the last stopped.
 *
 * No schedule. It is a one-off, run by hand through pg_net with the vault's
 * `app_origin` and `cron_secret`, the same pair the map sweep's tick uses.
 * Authorised like the other cron routes, with `Authorization: Bearer
 * $CRON_SECRET`, because every call spends model budget.
 */
async function tick(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runAreaCheckTick()) });
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
