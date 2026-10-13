import Link from '@/components/ui/link';
import { ListChecks } from 'lucide-react';
import type { Anchor } from '@/lib/todo/agenda/anchors';
import type { Task } from '@/lib/todo/tasks/model';
import { SearchEmpty } from '@/components/shell/search-empty';
import { SearchField } from '@/components/shell/search-field';
import { PageHeader } from '@/components/shell/page-header';
import { ListPage } from '@/components/patterns/list-detail';
import { EmptyState } from '@/components/ui/empty-state';
import { toggleChipClass } from '@/components/ui/chip';
import { QueueCleared } from '@/components/motion/clear';
import { TaskRow } from '@/components/todo/task-row';
import type { DevComment } from '@/lib/comments/load';
import type { TaskFile } from '@/components/attachments/task-files';
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
 * draw it from fixtures (plan #1603). Laid out as the list pattern
 * (components/patterns/list-detail.tsx): the header, the tabs and search,
 * one surface of rows, then the count (plan #1776).
 */
export function AllTasksView({
  status,
  search,
  focus,
  tasks,
  timezone,
  working,
  threads,
  files,
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
  /** The files each task holds (plan #1714), by the task's id. */
  files: Map<string, TaskFile[]>;
  anchors: Map<string, Anchor>;
  /** The title of the task each item sits under, by the item's id. */
  parents: Map<string, string>;
  /** What the quiet-day mark is drawn from, so it changes once a day. */
  seed: string;
}) {
  // No line under the title: the tabs below already say what the list covers.
  const header = (
    <>
      <PageHeader title="All tasks" />
      {focus && <FocusTask id={focus} />}
    </>
  );

  // Directly above the list it narrows, like every other list in the app. The
  // status filter rides along in the URL, so searching stays inside the tab
  // you are on.
  const tools = (
    <div className="flex flex-col gap-3">
      <nav className="flex flex-wrap items-center gap-1" aria-label="Filter by status">
        {FILTERS.map((filter) => {
          const href = { pathname: '/todo/all', query: { status: filter.id, ...(search ? { q: search } : {}) } };
          return (
            <Link
              key={filter.id}
              href={href}
              aria-current={filter.id === status ? 'page' : undefined}
              className={toggleChipClass(filter.id === status)}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>
      <SearchField placeholder="Search titles" />
    </div>
  );

  return (
    // Finishing the last open task draws the day's sigil in (plan #1340).
    // Keyed by the view, so opening a tab that is already empty is not a
    // clear.
    <QueueCleared key={`${status}:${search ?? ''}`} cleared={status === 'open' && !search && tasks.length === 0}>
      {tasks.length === 0 ? (
        <div className="mx-auto max-w-3xl">
          {header}
          {tools}
          {search ? (
            <SearchEmpty query={search} className="mt-6" />
          ) : (
            <AllTasksEmpty status={status} seed={seed} />
          )}
        </div>
      ) : (
        <ListPage header={header} tools={tools} foot={countLine(tasks.length, status, search)}>
          {tasks.map((task) => (
            <li
              key={task.id}
              id={`task-${task.id}`}
              className={cn(
                // The rows are the agenda's, so their links and title fields
                // get their phone press areas from here.
                'scroll-mt-24 px-3 [&_a]:press-area max-sm:[&_input]:min-h-11',
                task.id === focus && 'animate-[pulse_1.2s_ease-in-out_2] bg-accent-tint',
              )}
            >
              <TaskRow
                task={task}
                timezone={timezone}
                working={working}
                archive
                thread={threads.get(threadRef('task', task.id))}
                files={files.get(task.id)}
                filesOpen={task.id === focus}
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
            </li>
          ))}
        </ListPage>
      )}
    </QueueCleared>
  );
}

/**
 * The count under the list (plan #1776), in the tab's own word: "6 open",
 * "12 done", "40 tasks" on Everything, and what a search found.
 */
export function countLine(count: number, status: Filter, search: string): string {
  const word = status === 'all' ? (count === 1 ? 'task' : 'tasks') : status;
  return search ? `${count} ${word} matching “${search}”` : `${count} ${word}`;
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
