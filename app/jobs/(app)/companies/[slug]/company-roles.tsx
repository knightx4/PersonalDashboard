import Link, { linkVariants } from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { LinkedTasks } from '@/components/todo/linked-tasks';
import { formatDate } from '@/lib/jobs/applications/load';
import type { Task } from '@/lib/todo/tasks/model';
import { ReminderActions } from '@/app/jobs/(app)/_home/reminder-actions';
import { RolesList, type CompanyRoleRow } from './roles-list';

/** A to-do on one of this company's roles, with the role it belongs to. */
export type CompanyTodo = {
  id: string;
  body: string;
  dueAt: string;
  role: { id: string; title: string } | null;
};

/**
 * The company page's Roles tab (plan #1628): every role pursued here across
 * cycles, and what is outstanding on the company and its roles. Its own
 * component so the page and the gallery draw the same thing.
 */
export function CompanyRoles({
  companyId,
  slug,
  timezone,
  roles,
  tasks,
  todos,
}: {
  companyId: string;
  slug: string;
  timezone: string;
  roles: CompanyRoleRow[];
  tasks: Task[];
  todos: CompanyTodo[];
}) {
  return (
    <div className="space-y-6">
      <RolesList companyId={companyId} timezone={timezone} roles={roles} />

      {/* One section, not two. The company's own tasks and the to-dos sitting
          on its roles answer the same question -- what is outstanding here --
          and were being asked twice, side by side, under two names. */}
      <LinkedTasks
        target="company"
        targetId={companyId}
        returnTo={`/jobs/companies/${slug}`}
        tasks={tasks}
        timezone={timezone}
        extra={
          todos.length > 0 ? (
            <ul className="mt-2 divide-y divide-border">
              {todos.map((todo) => (
                <li key={todo.id} className="py-2 text-ui">
                  {/* The words take the full line; the date, the pursuit it belongs
                      to and the actions share the one under them, so a to-do reads
                      in two or three lines on a phone. */}
                  <p className="text-ink">{todo.body}</p>
                  <div className="mt-1 flex items-center gap-x-3 text-small text-ink-muted">
                    <span className="tabular shrink-0">{formatDate(todo.dueAt, timezone)}</span>
                    {/* Which pursuit it belongs to, and the way to it: the to-do is
                        the role's, and everything you would do with it beyond
                        finishing it is done there. */}
                    {todo.role && (
                      <Link
                        href={`/jobs/roles/${todo.role.id}`}
                        className={cn(linkVariants({ tone: 'quiet' }), 'press-area min-w-0 truncate')}
                      >
                        {todo.role.title}
                      </Link>
                    )}
                    <ReminderActions id={todo.id} title={todo.body} />
                  </div>
                </li>
              ))}
            </ul>
          ) : null
        }
      />
    </div>
  );
}
