import { after, NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runCompanyBoards } from '@/inngest/jobs/company-boards';

// Longer than the run's own 240-second budget, so the last batch finishes.
export const maxDuration = 300;

/**
 * The daily look for the job boards of the companies on file (plan #2535.2).
 *
 * POST is the daily cron's kick: it answers at once and works the run after
 * the response. GET runs it and answers with the counts, for a run by hand.
 * Both take `Authorization: Bearer $CRON_SECRET`.
 */
export async function POST(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  after(() =>
    runCompanyBoards().catch((error: unknown) => {
      console.error('[company boards]', error instanceof Error ? error.message : error);
    }),
  );
  return NextResponse.json({ ok: true }, { status: 202 });
}

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await runCompanyBoards()) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'failed' }, { status: 500 });
  }
}
