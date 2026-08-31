import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron, requestOrigin } from '@/inngest/cron/authorize';
import { runInboxIncrementalSync } from '@/inngest/cron/inbox';

// Long enough for the pump it starts: PUMP_BUDGET_MS is what that work is
// allowed to take, and a route that ends first takes the hand-off with it.
export const maxDuration = 300;

/**
 * Incremental sync for every connected inbox that finished its backfill.
 *
 * One pass now serves both workspaces. Not on a schedule of its own --
 * /api/cron/daily runs it, then the job sweep. It stays reachable so the sync
 * can be kicked by hand without waiting for the sweep.
 */
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runInboxIncrementalSync(requestOrigin(request))) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
