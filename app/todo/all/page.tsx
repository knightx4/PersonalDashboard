import Link from 'next/link';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { loadAllTasks } from '@/lib/todo/tasks/load';
import type { TaskStatus } from '@/lib/todo/tasks/model';
import { PageHeader } from '@/components/shell/page-header';
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
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search titles"
            aria-label="Search titles"
            className="h-9 w-48 rounded-lg border border-border bg-surface px-3 text-body text-ink placeholder:text-ink-ghost focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
          />
        </form>
      </div>

      {tasks.length === 0 ? (
        <p className="mt-6 rounded-card border border-border bg-surface p-8 text-center text-ui text-ink-muted">
          {search ? `Nothing matching “${search}”.` : 'Nothing here.'}
        </p>
      ) : (
        <div className="mt-4 divide-y divide-border rounded-card border border-border bg-surface px-3">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} timezone={settings.timezone} />
          ))}
        </div>
      )}
    </div>
  );
}
