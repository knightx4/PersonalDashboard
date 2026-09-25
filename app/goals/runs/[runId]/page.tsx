import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ListChecks } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadRunChanges } from '@/lib/goals/run-changes-store';
import { JOB_LABELS, runMeta, type RunListing } from '@/lib/goals/runs';
import { loadRun } from '@/lib/goals/runs-store';
import { RunChanges } from './run-changes';

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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader
        title={JOB_LABELS[run.job]}
        description={
          <>
            {run.item ? (
              run.item.level === 'goal' ? (
                <>
                  {'On '}
                  <Link
                    href={`/goals/${run.item.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {run.item.title}
                  </Link>
                  {' · '}
                </>
              ) : (
                <>{`On the step ${run.item.title} · `}</>
              )
            ) : run.area ? (
              <>
                {'On '}
                <Link href="/goals/all" className="underline-offset-2 hover:underline">
                  {run.area.name}
                </Link>
                {' · '}
              </>
            ) : null}
            {meta}
          </>
        }
        actions={
          <Link
            href="/goals/runs"
            className="text-small text-ink-muted underline-offset-2 hover:underline"
          >
            All runs
          </Link>
        }
      />
      {failed ? (
        <p className="text-small break-words whitespace-pre-wrap text-danger">
          {run.error ?? 'No reason was recorded.'}
        </p>
      ) : (
        run.summary && (
          <p className="text-small break-words whitespace-pre-wrap text-ink">{run.summary}</p>
        )
      )}
      {lines.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No changes"
          description="This run did not change any goal, step or collection."
        />
      ) : (
        <Card>
          <RunChanges runId={run.id} lines={lines} />
        </Card>
      )}
    </div>
  );
}
