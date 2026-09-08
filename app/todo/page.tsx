import { CalendarClock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { requireUser } from '@/lib/auth/server';
import { loadAgenda } from '@/lib/todo/agenda/load';
import { BUCKET_LABELS, todayIn } from '@/lib/todo/tasks/model';
import { PageHeader } from '@/components/shell/page-header';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
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

      {/* The account's own today, not the browser's: Today has to mean the day
          the list is kept in. */}
      <AddTask today={todayIn(agenda.timezone)} />

      {/* A source that failed is said out loud. Silently showing a shorter
          agenda would be the worst possible failure for this page: it looks
          exactly like a quiet day. */}
      {agenda.failed.length > 0 && (
        <Banner tone="bad" className="mt-4">
          {agenda.failed.join(' and ')} could not be read just now, so anything from{' '}
          {agenda.failed.length > 1 ? 'them' : 'it'} is missing from this page.
        </Banner>
      )}

      {empty ? (
        <EmptyState
          tone="finished"
          seed={`${user.id}:${new Date().toISOString().slice(0, 10)}:todo`}
          title="Nothing on the list."
          description="Write the next thing down and it will be here."
          className="mt-6"
        />
      ) : (
        <div className="mt-6 space-y-6">
          {agenda.piles.map(({ bucket, entries, context }) => (
            <section key={bucket}>
              <h2
                className={cn(
                  'text-ui font-semibold',
                  bucket === 'overdue' ? 'text-status-rejected' : 'text-ink',
                )}
              >
                {BUCKET_LABELS[bucket]}
                {entries.length > 0 && (
                  <span className="tabular ml-2 text-small font-normal text-ink-muted">
                    {entries.length}
                  </span>
                )}
              </h2>
              {/* What is already in these days. No checkbox: you do not tick
                  off a meeting, and offering to would be inviting someone to
                  lie to their own list. */}
              {context.length > 0 && (
                <ul className="mt-1 space-y-1">
                  {context.map((entry) => (
                    <li
                      key={entry.key}
                      className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-accent-tint px-3 py-1.5 text-small text-ink"
                    >
                      <CalendarClock className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
                      {entry.at && (
                        <span className="tabular font-medium">
                          {new Intl.DateTimeFormat('en-GB', {
                            timeZone: agenda.timezone,
                            weekday: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(new Date(entry.at))}
                        </span>
                      )}
                      <span className="font-medium">{entry.label}</span>
                      {entry.detail && <span className="text-ink-muted">{entry.detail}</span>}
                      {entry.link && (
                        <a
                          href={entry.link.href}
                          className="font-medium text-accent underline underline-offset-2"
                        >
                          {entry.link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {entries.length > 0 && (
                <Card padding="none" className="mt-1 divide-y divide-border px-3">
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
                </Card>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
