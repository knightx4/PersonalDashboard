'use client';

import { useState, useTransition } from 'react';
import { Check, Clock, Pin, RotateCcw, Trash2, Undo2, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import {
  bringBackTask,
  completeTask,
  dropTask,
  laterTask,
  pinTask,
  removeTask,
  reopenTask,
} from '@/app/todo/actions';
import type { Task } from '@/lib/todo/tasks/model';
import { EditTask } from './task-form';

/**
 * One task, and what you can do to it without leaving the list.
 *
 * The checkbox is the whole interaction most of the time, so it is the first
 * thing under the pointer and everything else is quieter. Nothing here opens a
 * detail page: a task with a detail page is a ticket, and this is a list.
 */
export function TaskRow({
  task,
  timezone,
  anchor,
}: {
  task: Task;
  timezone: string;
  /** What the task is about, when the list is not already inside that thing. */
  anchor?: { label: string; href: string } | null;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();

  if (editing) return <EditTask task={task} onDone={() => setEditing(false)} />;

  const done = task.status === 'done';
  const dropped = task.status === 'dropped';

  return (
    <div className={cn('group flex items-start gap-3 py-2.5', pending && 'opacity-50')}>
      <button
        type="button"
        aria-label={done ? 'Reopen' : 'Mark done'}
        onClick={() => start(() => (done ? reopenTask(task.id) : completeTask(task.id)))}
        className={cn(
          'press mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded border',
          done
            ? 'border-status-offer bg-status-offer text-surface'
            : 'border-control hover:border-accent',
        )}
      >
        {done && <Check className="size-3" strokeWidth={3} aria-hidden />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cn(
              'text-left text-ui font-medium text-ink hover:text-accent',
              (done || dropped) && 'text-ink-muted line-through',
            )}
          >
            {task.title}
          </button>

          {task.pinned && !done && !dropped && (
            <Pin className="size-3 text-accent" strokeWidth={2} aria-label="Pinned" />
          )}

          <DueLabel task={task} timezone={timezone} />

          {anchor && (
            <a
              href={anchor.href}
              className="truncate text-small text-ink-muted underline decoration-border underline-offset-2 hover:text-accent"
            >
              {anchor.label}
            </a>
          )}

          {dropped && <span className="text-micro text-ink-muted">dropped</span>}
        </div>

        {task.body && (
          <p className="mt-0.5 whitespace-pre-wrap text-small leading-snug text-ink-muted">
            {task.body}
          </p>
        )}
      </div>

      {/* Visible on hover on a pointer, always on a touch screen -- where there
          is no hover and a row whose actions never appear is a row you cannot
          act on. */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        {!done && !dropped && (
          <>
            <IconButton
              label={task.pinned ? 'Unpin' : 'Pin'}
              onClick={() => start(() => pinTask(task.id, !task.pinned))}
            >
              <Pin className="size-3.5" strokeWidth={1.75} aria-hidden />
            </IconButton>
            {task.snoozedUntil ? (
              <IconButton label="Bring back" onClick={() => start(() => bringBackTask(task.id))}>
                <Undo2 className="size-3.5" strokeWidth={1.75} aria-hidden />
              </IconButton>
            ) : (
              <IconButton label="Later" onClick={() => start(() => laterTask(task.id))}>
                <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
              </IconButton>
            )}
            <IconButton label="Drop" onClick={() => start(() => dropTask(task.id))}>
              <X className="size-3.5" strokeWidth={1.75} aria-hidden />
            </IconButton>
          </>
        )}

        {(done || dropped) && (
          <>
            <IconButton label="Reopen" onClick={() => start(() => reopenTask(task.id))}>
              <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden />
            </IconButton>
            <IconButton label="Delete" onClick={() => start(() => removeTask(task.id))}>
              <Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className="press flex size-7 items-center justify-center rounded text-ink-muted hover:bg-canvas hover:text-ink"
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

/**
 * When it is due, said the way it was written.
 *
 * A task with a time shows the time; a task with only a day shows only the day.
 * Showing "00:00" for a task due "Tuesday" would invent a precision that is not
 * in the data, which is the failure the two columns exist to prevent.
 */
function DueLabel({ task, timezone }: { task: Task; timezone: string }) {
  if (!task.dueOn && !task.dueAt) return null;

  const text = task.dueAt
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(task.dueAt))
    : new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        day: 'numeric',
        month: 'short',
      }).format(new Date(`${task.dueOn}T00:00:00Z`));

  return <span className="tabular text-small text-ink-muted">{text}</span>;
}
