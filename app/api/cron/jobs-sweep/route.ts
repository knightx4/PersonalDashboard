import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron } from '@/inngest/cron/authorize';
import { runJobSweep } from '@/inngest/jobs/cron/sweep';

export const maxDuration = 60;

/** The job workspace's sweep, on demand. /api/cron/daily runs it on schedule. */
export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    // `ok` follows the summary rather than being hardcoded: a sweep whose
    // queries failed still returns counts, and reading those as success is how
    // a broken rule stayed invisible for months.
    const summary = await runJobSweep();
    return NextResponse.json({ ok: summary.problems.length === 0, ...summary });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'failed' },
      { status: 500 },
    );
  }
}
