import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ListChecks } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { loadItemHrefs, loadRunChanges } from '@/lib/goals/run-changes-store';
import { areaHref } from '@/lib/goals/all-goals';
import { JOB_LABELS, runMeta, type RunListing } from '@/lib/goals/runs';
import { loadRun } from '@/lib/goals/runs-store';
import { RunChanges } from './run-changes';
import { LinkedText } from '@/components/ui/linked-text';

export const metadata = { title: 'Run' };
export const dynamic = 'force-dynamic';

/**
 * One goal run and what it changed (plan #1013): each change as a sentence,
 * read from goals.history by the run's id, with Undo on each of Claude's.
 * A change to a goal or step opens it, and so does the step the run was on
 * (note 55e9d14c).
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
  // The goal or step each change was made to: its first target in items.
  const itemOf = (line: (typeof lines)[number]) =>
    line.targets.find((target) => target.table === 'items')?.rowId ?? null;
  const itemIds = [
    ...lines.map(itemOf).filter((id): id is string => id !== null),
    ...(run.item ? [run.item.id] : []),
  ];
  const itemHrefs = await loadItemHrefs(client, itemIds).catch(() => new Map<string, string>());
  const hrefs: Record<string, string> = {};
  for (const line of lines) {
    const id = itemOf(line);
    const href = id ? itemHrefs.get(id) : undefined;
    if (href) hrefs[line.key] = href;
  }
  const runItemHref = run.item ? itemHrefs.get(run.item.id) : undefined;
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
              ) : runItemHref ? (
                <>
                  {'On the step '}
                  <Link href={runItemHref} className="underline-offset-2 hover:underline">
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
                <Link href={areaHref(run.area.id)} className="underline-offset-2 hover:underline">
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
          <LinkedText text={run.error ?? 'No reason was recorded.'} />
        </p>
      ) : (
        run.summary && (
          <p className="text-small break-words whitespace-pre-wrap text-ink">
            <LinkedText text={run.summary} />
          </p>
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
          <RunChanges runId={run.id} lines={lines} hrefs={hrefs} />
        </Card>
      )}
    </div>
  );
}
