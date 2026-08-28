import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron, requestOrigin } from '@/inngest/cron/authorize';
import { runShoppingIncrementalSync } from '@/inngest/cron/shopping-inbox';

export const maxDuration = 60;

/**
 * Incremental sync for every commerce inbox that finished its backfill.
 *
 * No longer on a schedule of its own -- /api/cron/daily runs it, along with
 * the job workspace's two. It stays reachable so a single workspace can be
 * kicked by hand without running the others.
 */
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runShoppingIncrementalSync(requestOrigin(request))) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
