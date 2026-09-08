import Link from 'next/link';
import { ListChecks, Search } from 'lucide-react';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { loadAllTasks } from '@/lib/todo/tasks/load';
import type { TaskStatus } from '@/lib/todo/tasks/model';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { TaskRow } from '@/components/todo/task-row';
import { cn } from '@/lib/cn';

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
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const status: Filter = FILTERS.some((f) => f.id === params.status)
    ? (params.status as Filter)
    : 'open';
  const search = params.q?.trim() ?? '';

  const [settings, tasks] = await Promise.all([
    loadAccountSettings(user.id),
    loadAllTasks(user.id, {
      status: status === 'all' ? 'all' : (status as TaskStatus),
      search,
    }),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="All tasks" description="Everything, including what is finished." />

      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex items-center gap-1" aria-label="Filter by status">
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

        {/* A plain GET form: a search box that needs JavaScript to search is a
            search box that does not work on a slow connection. */}
        <form action="/todo/all" className="ml-auto flex items-center gap-2">
          <input type="hidden" name="status" value={status} />
          <Input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search titles"
            aria-label="Search titles"
            className="w-48"
          />
        </form>
      </div>

      {tasks.length === 0 ? (
        <AllTasksEmpty
          status={status}
          search={search}
          seed={`${user.id}:${new Date().toISOString().slice(0, 10)}:todo-all`}
        />
      ) : (
        <Card padding="none" className="mt-4 divide-y divide-border px-3">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} timezone={settings.timezone} />
          ))}
        </Card>
      )}
    </div>
  );
}

/**
 * Three kinds of nothing. A search that found nothing offers to clear itself;
 * an empty Open list is the list finished, so it gets the quiet-day mark; an
 * empty archive is waiting for the agenda to feed it.
 */
function AllTasksEmpty({
  status,
  search,
  seed,
}: {
  status: Filter;
  search: string;
  seed: string;
}) {
  if (search) {
    return (
      <EmptyState
        icon={Search}
        title="Nothing matched"
        description={`No ${status === 'all' ? '' : `${status} `}task has “${search}” in its title.`}
        action={{ label: 'Clear the search', href: `/todo/all?status=${status}` }}
        className="mt-6"
      />
    );
  }

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
