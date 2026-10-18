import { CalendarClock } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { DevComment } from '@/lib/comments/load';
import type { AgendaPile } from '@/lib/todo/agenda/merge';
import { threadRef } from '@/lib/thread/subjects';
import { BUCKET_LABELS } from '@/lib/todo/tasks/model';
import { formatClock } from '@/lib/core/when';
import type { TaskFile } from '@/components/attachments/task-files';
import { Card } from '@/components/ui/card';
import Link, { linkVariants } from '@/components/ui/link';
import { TaskRow } from '@/components/todo/task-row';
import { AgendaItemRow } from '@/components/todo/agenda-item-row';

/**
 * The agenda's piles, each under its heading (app/todo/page.tsx). Out of the
 * page so the gallery can draw them from fixtures, the tag filter's narrowed
 * list among them (plan #2340.3).
 */
export function AgendaPiles({
  piles,
  timezone,
  working,
  threads,
  files,
  className,
}: {
  piles: AgendaPile[];
  timezone: string;
  working: readonly string[];
  threads: Map<string, DevComment[]>;
  files: Map<string, TaskFile[]>;
  className?: string;
}) {
  return (
    <div className={cn('space-y-6', className)}>
      {piles.map(({ bucket, entries, context }) => {
        // The pile in the order it is about to be drawn in, so a row can
        // send it back with a move. Tasks only: an interview or a return
        // deadline is not a row this account owns, so there is nowhere to
        // write an order for it.
        const pile = entries
          .filter((entry) => entry.kind === 'task' && entry.task)
          .map((entry) => entry.task!.id);

        return (
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
                    className="flex flex-wrap items-baseline gap-x-2 rounded-control bg-accent-tint px-3 py-1.5 text-small text-ink"
                  >
                    <CalendarClock
                      className="size-3.5 shrink-0 text-accent"
                      strokeWidth={1.75}
                      aria-hidden
                    />
                    {entry.at && (
                      <span className="tabular font-medium">
                        {formatClock(entry.at, {
                          timeZone: timezone,
                          weekday: 'short',
                        })}
                      </span>
                    )}
                    <span className="font-medium">{entry.label}</span>
                    {entry.detail && <span className="text-ink-muted">{entry.detail}</span>}
                    {entry.link && (
                      <Link href={entry.link.href} className={linkVariants()}>
                        {entry.link.label}
                      </Link>
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
                      timezone={timezone}
                      anchor={entry.anchor}
                      pile={pile}
                      items={entry.children}
                      working={working}
                      thread={threads.get(threadRef('task', entry.task.id))}
                      files={files.get(entry.task.id)}
                    />
                  ) : entry.item ? (
                    <AgendaItemRow key={entry.key} item={entry.item} timezone={timezone} />
                  ) : null,
                )}
              </Card>
            )}
          </section>
        );
      })}
    </div>
  );
}
