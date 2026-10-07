import Link from 'next/link';
import { ListChecks } from 'lucide-react';
import type { Anchor } from '@/lib/todo/agenda/anchors';
import type { Task } from '@/lib/todo/tasks/model';
import { SearchEmpty } from '@/components/shell/search-empty';
import { SearchField } from '@/components/shell/search-field';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { QueueCleared } from '@/components/motion/clear';
import { TaskRow } from '@/components/todo/task-row';
import type { DevComment } from '@/lib/comments/load';
import { threadRef } from '@/lib/thread/subjects';
import { cn } from '@/lib/cn';
import { FocusTask } from './focus';

export const FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'dropped', label: 'Dropped' },
  { id: 'all', label: 'Everything' },
] as const;

export type Filter = (typeof FILTERS)[number]['id'];

/**
 * All tasks, drawn from what the page read (page.tsx), so the gallery can
 * draw it from fixtures (plan #1603).
 */
export function AllTasksView({
  status,
  search,
  focus,
  tasks,
  timezone,
  working,
  threads,
  anchors,
  parents,
  seed,
}: {
  status: Filter;
  search: string;
  focus: string;
  tasks: Task[];
  timezone: string;
  working: readonly string[];
  threads: Map<string, DevComment[]>;
  anchors: Map<string, Anchor>;
  /** The title of the task each item sits under, by the item's id. */
  parents: Map<string, string>;
  /** What the quiet-day mark is drawn from, so it changes once a day. */
  seed: string;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="All tasks" description="Everything, including what is finished." />

      {focus && <FocusTask id={focus} />}

      <div className="flex flex-col gap-3">
        <nav className="flex flex-wrap items-center gap-1" aria-label="Filter by status">
          {FILTERS.map((filter) => {
            const href = { pathname: '/todo/all', query: { status: filter.id, ...(search ? { q: search } : {}) } };
            return (
              <Link
                key={filter.id}
                href={href}
                aria-current={filter.id === status ? 'page' : undefined}
                className={cn(
                  'press-area rounded-lg px-3 py-1.5 text-ui font-medium transition-colors duration-quick',
                  filter.id === status
                    ? 'bg-accent-tint text-accent'
                    : 'text-ink-muted hover:bg-canvas hover:text-ink',
                )}
              >
                {filter.label}
              </Link>
            );
          })}
        </nav>

        {/* Directly above the list it narrows, like every other list in the
            app. The status filter rides along in the URL, so searching stays
            inside the tab you are on. */}
        <SearchField placeholder="Search titles" />
      </div>

      {/* Finishing the last open task draws the day's sigil in (plan #1340).
          Keyed by the view, so opening a tab that is already empty is not a
          clear. */}
      <QueueCleared key={`${status}:${search ?? ''}`} cleared={status === 'open' && !search && tasks.length === 0}>
      {tasks.length === 0 && search ? (
        <SearchEmpty query={search} className="mt-6" />
      ) : tasks.length === 0 ? (
        <AllTasksEmpty
          status={status}
          seed={seed}
        />
      ) : (
        <Card
          padding="none"
          // The rows are the agenda's, so their links and title fields get
          // their phone press areas from here.
          className="mt-4 divide-y divide-border px-3 [&_a]:press-area max-sm:[&_input]:min-h-11"
        >
          {tasks.map((task) => (
            <div
              key={task.id}
              id={`task-${task.id}`}
              className={cn(
                'scroll-mt-24 -mx-3 px-3',
                task.id === focus && 'animate-[pulse_1.2s_ease-in-out_2] rounded-lg bg-accent-tint',
              )}
            >
              <TaskRow
                task={task}
                timezone={timezone}
                working={working}
                thread={threads.get(threadRef('task', task.id))}
                anchor={anchors.get(task.id) ?? null}
                under={
                  parents.has(task.id)
                    ? {
                        label: parents.get(task.id)!,
                        // Whatever the holding task's status, so the link never
                        // lands on a filter that hides the row it names.
                        href: `/todo/all?status=all&focus=${task.parentId}`,
                      }
                    : null
                }
              />
            </div>
          ))}
        </Card>
      )}
      </QueueCleared>
    </div>
  );
}


/**
 * Two kinds of nothing, neither of them a search: an empty Open list is the
 * list finished, so it gets the quiet-day mark, and an empty archive is
 * waiting for the agenda to feed it. A search that matched nothing is the
 * shared empty state, rendered by the page above.
 */
function AllTasksEmpty({ status, seed }: { status: Filter; seed: string }) {
  if (status === 'open') {
    return (
      <EmptyState
        tone="finished"
        seed={seed}
        title="Nothing open."
        description="Everything you wrote down is done or dropped. Write the next thing on the agenda."
        action={{ label: 'Go to the agenda', href: '/todo' }}
        className="mt-6"
      />
    );
  }

  return (
    <EmptyState
      icon={ListChecks}
      title="Nothing here yet"
      description="Tasks you finish or drop on the agenda are kept here, so what happened is never lost."
      action={{ label: 'Go to the agenda', href: '/todo' }}
      className="mt-6"
    />
  );
}
