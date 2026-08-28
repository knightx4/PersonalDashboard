import { NextResponse, type NextRequest } from 'next/server';
import { authorizeCron, requestOrigin } from '@/inngest/cron/authorize';
import { runInboxIncrementalSync } from '@/inngest/cron/inbox';
import { runJobSweep } from '@/inngest/jobs/cron/sweep';

export const maxDuration = 60;

/**
 * Everything scheduled, behind one cron.
 *
 * Two stages now rather than three: there is one inbox sync, shared by both
 * workspaces, and then the job sweep. Their order is the point -- a message
 * that arrived this morning has to be ingested before anything is judged to
 * have gone quiet.
 *
 * Each stage is isolated. A failure in one is reported and the rest still run,
 * because the alternative is that a broken job inbox silently stops the
 * commerce sync that has been working for months.
 */
type Stage = { name: string; run: () => Promise<unknown> };

export async function GET(request: NextRequest) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const origin = requestOrigin(request);
  const stages: Stage[] = [
    { name: 'inbox', run: () => runInboxIncrementalSync(origin) },
    { name: 'jobs-sweep', run: () => runJobSweep() },
  ];

  const results: Record<string, unknown> = {};
  const failed: string[] = [];

  for (const stage of stages) {
    try {
      results[stage.name] = await stage.run();
    } catch (err) {
      failed.push(stage.name);
      results[stage.name] = { error: err instanceof Error ? err.message : 'failed' };
    }
  }

  // 207: some stages may have failed while others did real work, and a plain
  // 500 would tell a log reader nothing about which.
  return NextResponse.json({ ok: failed.length === 0, failed, results }, {
    status: failed.length === 0 ? 200 : 207,
  });
}
