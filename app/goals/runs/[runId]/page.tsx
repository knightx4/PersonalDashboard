import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadRunChanges } from '@/lib/goals/run-changes-store';
import { runMeta, type RunListing } from '@/lib/goals/runs';
import { loadRun } from '@/lib/goals/runs-store';
import { RunView } from './run-view';

export const metadata = { title: 'Run' };
export const dynamic = 'force-dynamic';

/**
 * One goal run and what it changed (plan #1013): each change as a sentence,
 * read from goals.history by the run's id, with Undo on each of Claude's.
 */

/** Outside the component because it reads the clock. */
function headerLine(run: RunListing, timeZone: string) {
  return runMeta(run, Date.now(), timeZone);
}

export default async function GoalRunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) notFound();
  const user = await requireUser();
  const [account, client] = await Promise.all([loadAccountSettings(user.id), createGoalsClient()]);
  const run = await loadRun(client, runId);
  if (!run) notFound();
  const lines = await loadRunChanges(client, runId);
  const { outcome, meta } = headerLine(run, account.timezone);
  const failed = outcome === 'failed';

  return <RunView run={run} lines={lines} failed={failed} meta={meta} />;
}
