import Link from 'next/link';
import { CardSection } from '@/components/ui/card';
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
      <CardSection title="Roles here, across cycles">
        <RolesList companyId={companyId} timezone={timezone} roles={roles} />
      </CardSection>

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
                <li key={todo.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-ui">
                  <span className="tabular shrink-0 text-ink-muted">
                    {formatDate(todo.dueAt, timezone)}
                  </span>
                  <span className="text-ink">{todo.body}</span>
                  {/* Which pursuit it belongs to, and the way to it: the to-do is
                      the role's, and everything you would do with it beyond
                      finishing it is done there. */}
                  {todo.role && (
                    <Link
                      href={`/jobs/roles/${todo.role.id}`}
                      className="press-area text-small text-ink-muted underline underline-offset-2 transition-colors duration-quick hover:text-ink"
                    >
                      {todo.role.title}
                    </Link>
                  )}
                  <ReminderActions id={todo.id} />
                </li>
              ))}
            </ul>
          ) : null
        }
      />
    </div>
  );
}
