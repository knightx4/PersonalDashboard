import Link from 'next/link';
import { History } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { JOB_LABELS, runMeta, type RunListing, type RunOutcome } from '@/lib/goals/runs';
import { loadRuns } from '@/lib/goals/runs-store';

export const metadata = { title: 'Runs' };
export const dynamic = 'force-dynamic';

/**
 * Every goal run, newest first (plan #1012): what started it, the goal or
 * step it was on, how it ended, how long it took, and its summary or error.
 * Read from goals.runs; a failed run shows the reason it recorded. Each
 * run opens to what it changed (plan #1013).
 */

type RunView = {
  run: RunListing;
  outcome: RunOutcome;
  meta: string;
};

/**
 * The line under each run's heading. Outside the component because it reads
 * the clock, and reading the clock during render is unstable.
 */
function runViews(runs: RunListing[], timeZone: string): RunView[] {
  const now = Date.now();
  return runs.map((run) => ({ run, ...runMeta(run, now, timeZone) }));
}

export default async function GoalRunsPage() {
  const user = await requireUser();
  const [account, client] = await Promise.all([loadAccountSettings(user.id), createGoalsClient()]);
  const runs = await loadRuns(client);
  const views = runViews(runs, account.timezone);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Runs" />
      {views.length === 0 ? (
        <EmptyState
          icon={History}
          title="No runs yet"
          description="Press Work on this on a goal, and each run Claude makes on it will be listed here."
          action={{ label: 'All goals', href: '/goals/all' }}
        />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {views.map((view) => (
              <RunRow key={view.run.id} view={view} />
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function RunRow({ view: { run, outcome, meta } }: { view: RunView }) {
  const failed = outcome === 'failed';
  return (
    <li className="row-pad space-y-1">
      <p className="text-ui break-words text-ink">
        <Link href={`/goals/runs/${run.id}`} className="font-semibold underline-offset-2 hover:underline">
          {JOB_LABELS[run.job]}
        </Link>
        {run.item && (
          <>
            {' on '}
            {run.item.level === 'goal' ? (
              <Link href={`/goals/${run.item.id}`} className="underline-offset-2 hover:underline">
                {run.item.title}
              </Link>
            ) : (
              <span>the step {run.item.title}</span>
            )}
          </>
        )}
      </p>
      <p className={failed ? 'text-small text-danger' : 'text-small text-ink-muted'}>{meta}</p>
      {failed ? (
        <p className="text-small break-words whitespace-pre-wrap text-danger">{run.error ?? 'No reason was recorded.'}</p>
      ) : (
        run.summary && (
          <p className="text-small break-words whitespace-pre-wrap text-ink">{run.summary}</p>
        )
      )}
    </li>
  );
}
