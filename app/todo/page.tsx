import { ListChecks } from 'lucide-react';
import { cn } from '@/lib/cn';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { loadOpenTasks } from '@/lib/todo/tasks/load';
import { BUCKET_LABELS, bucketTasks } from '@/lib/todo/tasks/model';
import { PageHeader } from '@/components/shell/page-header';
import { AddTask } from '@/components/todo/task-form';
import { TaskRow } from '@/components/todo/task-row';

export const metadata = { title: 'Agenda' };

/**
 * What has to happen.
 *
 * Piles rather than one flat list, and a pile that is empty is not shown at
 * all: a quiet week should look quiet. /jobs/today set that tone and it was
 * right there too.
 *
 * Only the tasks you typed, for now. Job reminders and return deadlines arrive
 * through the source registry in a later step, and read at query time rather
 * than being copied here -- an obligation is displayed by whoever needs to show
 * it and written by whoever owns it.
 */
export default async function TodoPage() {
  const user = await requireUser();
  const [settings, tasks] = await Promise.all([
    loadAccountSettings(user.id),
    loadOpenTasks(user.id),
  ]);

  const buckets = bucketTasks(tasks, { timezone: settings.timezone });
  const empty = buckets.length === 0;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Agenda"
        description={
          empty ? 'Nothing on the list.' : 'What needs you, in the order it runs out.'
        }
      />

      <AddTask />

      {empty ? (
        <div className="mt-6 rounded-card border border-border bg-surface p-8 text-center">
          <ListChecks
            className="mx-auto size-8 text-status-offer"
            strokeWidth={1.5}
            aria-hidden
          />
          <p className="mt-3 text-sm font-medium text-ink">Nothing on the list.</p>
          <p className="mt-1 text-[13px] text-ink-muted">
            Write the next thing down and it will be here.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {buckets.map(({ bucket, tasks: pile }) => (
            <section key={bucket}>
              <h2
                className={cn(
                  'text-[13px] font-semibold',
                  bucket === 'overdue' ? 'text-status-rejected' : 'text-ink',
                )}
              >
                {BUCKET_LABELS[bucket]}
                <span className="tabular ml-2 text-[12px] font-normal text-ink-faint">
                  {pile.length}
                </span>
              </h2>
              <div className="mt-1 divide-y divide-border rounded-card border border-border bg-surface px-3">
                {pile.map((task) => (
                  <TaskRow key={task.id} task={task} timezone={settings.timezone} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
