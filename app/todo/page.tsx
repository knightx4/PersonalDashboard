import { ListChecks, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/cn';
import { requireUser } from '@/lib/auth/server';
import { loadAgenda } from '@/lib/todo/agenda/load';
import { BUCKET_LABELS } from '@/lib/todo/tasks/model';
import { PageHeader } from '@/components/shell/page-header';
import { AddTask } from '@/components/todo/task-form';
import { TaskRow } from '@/components/todo/task-row';
import { AgendaItemRow } from '@/components/todo/agenda-item-row';

export const metadata = { title: 'Agenda' };

/**
 * What has to happen.
 *
 * Piles rather than one flat list, and an empty pile is not shown at all: a
 * quiet week should look quiet. /jobs/today set that tone and it was right
 * there too.
 *
 * The tasks are this module's. Everything else on the page was read from
 * whichever workspace owns it, at the moment the page rendered, and is written
 * back to that workspace when you act on it. Nothing here is a copy.
 */
export default async function TodoPage() {
  const user = await requireUser();
  const agenda = await loadAgenda(user.id);

  const empty = agenda.piles.length === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Agenda"
        description={empty ? 'Nothing on the list.' : 'What needs you, in the order it runs out.'}
      />

      <AddTask />

      {/* A source that failed is said out loud. Silently showing a shorter
          agenda would be the worst possible failure for this page: it looks
          exactly like a quiet day. */}
      {agenda.failed.length > 0 && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-accent-orange-tint px-3 py-2 text-[13px] text-ink">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
          <span>
            {agenda.failed.join(' and ')} could not be read just now, so anything from{' '}
            {agenda.failed.length > 1 ? 'them' : 'it'} is missing from this page.
          </span>
        </p>
      )}

      {empty ? (
        <div className="mt-6 rounded-card border border-border bg-surface p-8 text-center">
          <ListChecks className="mx-auto size-8 text-status-offer" strokeWidth={1.5} aria-hidden />
          <p className="mt-3 text-sm font-medium text-ink">Nothing on the list.</p>
          <p className="mt-1 text-[13px] text-ink-muted">
            Write the next thing down and it will be here.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {agenda.piles.map(({ bucket, entries }) => (
            <section key={bucket}>
              <h2
                className={cn(
                  'text-[13px] font-semibold',
                  bucket === 'overdue' ? 'text-status-rejected' : 'text-ink',
                )}
              >
                {BUCKET_LABELS[bucket]}
                <span className="tabular ml-2 text-[12px] font-normal text-ink-faint">
                  {entries.length}
                </span>
              </h2>
              <div className="mt-1 divide-y divide-border rounded-card border border-border bg-surface px-3">
                {entries.map((entry) =>
                  entry.kind === 'task' && entry.task ? (
                    <TaskRow
                      key={entry.key}
                      task={entry.task}
                      timezone={agenda.timezone}
                      anchor={entry.anchor}
                    />
                  ) : entry.item ? (
                    <AgendaItemRow key={entry.key} item={entry.item} timezone={agenda.timezone} />
                  ) : null,
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
