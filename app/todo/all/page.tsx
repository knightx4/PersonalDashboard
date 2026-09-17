import Link from 'next/link';
import { ListChecks } from 'lucide-react';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { loadAllTasks, loadParentTitles } from '@/lib/todo/tasks/load';
import { loadLinksForTasks } from '@/lib/todo/links/load';
import { resolveAnchors } from '@/lib/todo/agenda/anchors';
import type { TaskStatus } from '@/lib/todo/tasks/model';
import { PageHeader } from '@/components/shell/page-header';
import { SearchEmpty } from '@/components/shell/search-empty';
import { SearchField } from '@/components/shell/search-field';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { TaskRow } from '@/components/todo/task-row';
import { cn } from '@/lib/cn';
import { FocusTask } from './focus';

export const metadata = { title: 'All tasks' };

const FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'dropped', label: 'Dropped' },
  { id: 'all', label: 'Everything' },
] as const;

type Filter = (typeof FILTERS)[number]['id'];

/**
 * Everything, including what is finished.
 *
 * Kept off the agenda deliberately: the agenda answers "what needs me" and an
 * archive answers "what happened", and a page that tries to do both ends up
 * being the second one. This is the page you visit to find something, which is
 * why it has a search box and no piles.
 */
export default async function AllTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; focus?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const status: Filter = FILTERS.some((f) => f.id === params.status)
    ? (params.status as Filter)
    : 'open';
  const search = params.q?.trim() ?? '';
  // A task is the one thing in the app with no page of its own, so the command
  // palette sends you here with the row named. Absent, nothing changes.
  const focus = params.focus?.trim() ?? '';

  const [settings, tasks] = await Promise.all([
    loadAccountSettings(user.id),
    loadAllTasks(user.id, {
      status: status === 'all' ? 'all' : (status as TaskStatus),
      search,
    }),
  ]);

  // What each task is about, in one pass for the page. The naive shape resolves
  // a row's anchor as it renders, which is a query per row and does not look
  // slow until the archive is long -- which is the only state this page is ever
  // in. A workspace that cannot be read costs its labels and nothing else;
  // resolveAnchors swallows that per target.
  const links = await loadLinksForTasks(tasks.map((task) => task.id));
  const [anchors, parents] = await Promise.all([
    resolveAnchors(links),
    // Which task an item came out of. Only the titles, and only for the rows
    // on this page -- the list here is not nested, so the row has to say it.
    loadParentTitles(user.id, tasks),
  ]);

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
                  'rounded-lg px-3 py-1.5 text-ui font-medium transition-colors duration-150',
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

      {tasks.length === 0 && search ? (
        <SearchEmpty query={search} className="mt-6" />
      ) : tasks.length === 0 ? (
        <AllTasksEmpty
          status={status}
          seed={`${user.id}:${new Date().toISOString().slice(0, 10)}:todo-all`}
        />
      ) : (
        <Card padding="none" className="mt-4 divide-y divide-border px-3">
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
                timezone={settings.timezone}
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
