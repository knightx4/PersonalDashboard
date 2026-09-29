import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runRecurringReread } from '@/inngest/cron/recurring-reread';

export const maxDuration = 120;

/**
 * Re-reading receipts filed under a store's name (plan #1212), on demand.
 * /api/cron/daily runs it every morning after the inbox sync.
 */
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runRecurringReread()) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
