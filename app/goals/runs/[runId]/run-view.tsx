import Link from 'next/link';
import { ListChecks } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { LinkedText } from '@/components/ui/linked-text';
import type { ChangeLine } from '@/lib/goals/run-changes';
import { JOB_LABELS, type RunListing } from '@/lib/goals/runs';
import { RunChanges } from './run-changes';

/**
 * One goal run as its page draws it (plan #1601): what started it, what it
 * was on, how it ended, and each change it made. `meta` is the line the page
 * worked out from the clock, so the gallery draws it from fixtures.
 */
export function RunView({
  run,
  lines,
  failed,
  meta,
}: {
  run: RunListing;
  lines: ChangeLine[];
  failed: boolean;
  meta: string;
}) {
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
            className="press-area text-small text-ink-muted underline-offset-2 hover:underline"
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
          <RunChanges runId={run.id} lines={lines} />
        </Card>
      )}
    </div>
  );
}
