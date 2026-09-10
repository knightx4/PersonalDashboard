'use client';

import { useActionState, useRef, useState, useTransition, type ReactNode } from 'react';
import Link from 'next/link';
import { ListChecks, Plus, Unlink } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { TASK_STATUS_GLYPHS } from '@/lib/status-glyphs';
import { cardVariants } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { FieldError, Input } from '@/components/ui/field';
import { completeTask, reopenTask } from '@/app/todo/actions';
import { addLinkedTask, detachTask, type LinkedTaskState } from '@/app/todo/link-actions';
import type { LinkTarget } from '@/lib/todo/links/model';
import type { Task } from '@/lib/todo/tasks/model';

/**
 * The tasks attached to one thing, wherever that thing is rendered.
 *
 * One component for four workspaces, because "what is outstanding on this" is
 * the same question on a role, a company, a contact and a note, and four
 * copies of it would drift within a month.
 *
 * Deliberately small: a title, a date, a checkbox. Anything more and it stops
 * being a section on somebody else's page and starts being a todo app growing
 * inside the job tracker.
 */
export function LinkedTasks({
  target,
  targetId,
  returnTo,
  tasks,
  timezone,
  title = 'Tasks',
  compact = false,
  extra,
}: {
  target: LinkTarget;
  targetId: string;
  /** The page this section is on, so a write can refresh it. */
  returnTo: string;
  tasks: Task[];
  timezone: string;
  title?: string;
  compact?: boolean;
  /**
   * Outstanding work on this thing that is not a todo-module task -- the job
   * module's own reminders, say. It belongs under this heading rather than in
   * a second section beside it: "what is outstanding here" is one question,
   * and asking it twice on one page is what it looks like when it is two.
   */
  extra?: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const [state, action, pending] = useActionState<LinkedTaskState, FormData>(
    async (prev, formData) => {
      const result = await addLinkedTask(prev, formData);
      if (result.message) {
        formRef.current?.reset();
        setAdding(false);
      }
      return result;
    },
    {},
  );

  return (
    <section className={cn(!compact && cardVariants({ padding: 'dense' }))}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-ui font-semibold text-ink">
          <ListChecks className="size-3.5 text-ink-muted" strokeWidth={1.75} aria-hidden />
          {title}
          {tasks.length > 0 && (
            <span className="tabular text-small font-normal text-ink-muted">{tasks.length}</span>
          )}
        </h3>
        <Button type="button" variant="ghost" size="sm" onClick={() => setAdding((open) => !open)}>
          <Plus className="size-3.5" strokeWidth={2} aria-hidden />
          {adding ? 'Cancel' : 'Add'}
        </Button>
      </div>

      {adding && (
        <form ref={formRef} action={action} className="mt-3 space-y-2">
          <input type="hidden" name="target" value={target} />
          <input type="hidden" name="targetId" value={targetId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Input
            name="title"
            placeholder="What has to happen?"
            aria-label="Task"
            required
            autoFocus
          />
          <div className="flex items-center gap-2">
            <Input name="dueOn" type="date" aria-label="Due" className="w-40" />
            <Button type="submit" size="sm" disabled={pending}>
              Add
            </Button>
          </div>
          <FieldError>{state.error}</FieldError>
        </form>
      )}

      {tasks.length === 0 ? (
        !adding && !extra && <p className="mt-2 text-ui text-ink-muted">Nothing outstanding.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {tasks.map((task) => (
            <LinkedRow
              key={task.id}
              task={task}
              timezone={timezone}
              target={target}
              targetId={targetId}
              returnTo={returnTo}
            />
          ))}
        </ul>
      )}

      {extra}
    </section>
  );
}

function LinkedRow({
  task,
  timezone,
  target,
  targetId,
  returnTo,
}: {
  task: Task;
  timezone: string;
  target: LinkTarget;
  targetId: string;
  returnTo: string;
}) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const done = task.status === 'done';
  const dropped = task.status === 'dropped';

  return (
    <li className={cn('group flex items-center gap-2 py-1.5', pending && 'opacity-50')}>
      {/* The same toggle as a row on /todo: the glyph is the state, the
          button is the hit area. */}
      <button
        type="button"
        aria-label={done ? 'Reopen' : 'Mark done'}
        onClick={() =>
          start(async () => {
            const { error } = await (done ? reopenTask(task.id) : completeTask(task.id));
            if (error) toast({ text: error });
          })
        }
        className={cn(
          'press flex size-4 shrink-0 items-center justify-center transition-colors duration-150',
          done
            ? 'text-status-offer'
            : dropped
              ? 'text-ink-muted'
              : 'text-ink-muted hover:text-accent',
        )}
      >
        <StatusGlyph glyph={TASK_STATUS_GLYPHS[task.status]} size={14} />
      </button>

      <span
        className={cn(
          'min-w-0 flex-1 truncate text-ui text-ink',
          (done || dropped) && 'text-ink-muted line-through',
        )}
      >
        {task.title}
      </span>

      {(task.dueOn || task.dueAt) && (
        <span className="tabular shrink-0 text-small text-ink-muted">
          {formatDue(task, timezone)}
        </span>
      )}

      {/* Detach, not delete. The task is yours and may well belong somewhere
          else; unlinking it from this page must not destroy it. */}
      <button
        type="button"
        title="Detach from this"
        onClick={() => start(() => detachTask(task.id, target, targetId, returnTo))}
        className="press flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted opacity-100 transition-colors duration-150 hover:bg-sunken hover:text-ink sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
      >
        <Unlink className="size-3.5" strokeWidth={1.75} aria-hidden />
        <span className="sr-only">Detach from this</span>
      </button>
    </li>
  );
}

function formatDue(task: Task, timezone: string): string {
  if (task.dueAt) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(task.dueAt));
  }
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${task.dueOn}T00:00:00Z`));
}

/** A link to the agenda, for a section that has more than it can show. */
export function AllTasksLink() {
  return (
    <Link href="/todo" className="text-ui font-medium text-accent hover:underline">
      All tasks
    </Link>
  );
}
