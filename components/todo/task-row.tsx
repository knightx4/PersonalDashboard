'use client';

import { useState, useTransition } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Clock,
  GripVertical,
  Pin,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { TASK_STATUS_GLYPHS } from '@/lib/status-glyphs';
import { useToast } from '@/components/ui/toast';
import {
  bringBackTask,
  completeTask,
  dropTask,
  laterTask,
  moveTask,
  pinTask,
  placeTask,
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
 *
 * Done, drop and later each have an inverse in app/todo/actions.ts, so they
 * happen at once and offer the way back in a toast. Delete has none, so it is
 * the one action here that asks first.
 */
/**
 * Which task is in the air.
 *
 * Module-level rather than state, because `dragover` cannot read the
 * dataTransfer -- the payload is only legible on `drop` -- and a row still has
 * to decide whether the thing crossing it is one of its own siblings before it
 * offers to catch it. One list is dragged at a time, so one variable is enough.
 */
let dragging: string | null = null;

export function TaskRow({
  task,
  timezone,
  anchor,
  pile,
}: {
  task: Task;
  timezone: string;
  /** What the task is about, when the list is not already inside that thing. */
  anchor?: { label: string; href: string } | null;
  /**
   * The tasks of the pile this row is in, in the order they are on screen.
   *
   * Sent back with a move because that order does not exist anywhere else: the
   * piles are worked out from dates while rendering, not stored. Absent on a
   * list that is not a pile -- an archive is a history and is read in the order
   * it happened.
   */
  pile?: readonly string[];
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [grabbed, setGrabbed] = useState(false);
  /** Which edge of this row the dragged task would land on, while it is over. */
  const [edge, setEdge] = useState<'top' | 'bottom' | null>(null);
  const toast = useToast();

  // A pile of one has no order to change.
  const siblings = pile && pile.length > 1 ? pile : [];
  const index = siblings.indexOf(task.id);

  if (editing) return <EditTask task={task} onDone={() => setEditing(false)} />;

  const done = task.status === 'done';
  const dropped = task.status === 'dropped';

  function complete() {
    start(async () => {
      await completeTask(task.id);
      toast({ text: 'done', undo: () => reopenTask(task.id), undone: 'reopened' });
    });
  }

  function drop() {
    start(async () => {
      await dropTask(task.id);
      // reopenTask is the inverse of a drop: bringBackTask undoes a snooze.
      toast({ text: 'dropped', undo: () => reopenTask(task.id), undone: 'back on the list' });
    });
  }

  function later() {
    start(async () => {
      await laterTask(task.id);
      toast({ text: 'until later', undo: () => bringBackTask(task.id), undone: 'brought back' });
    });
  }

  function move(direction: 'up' | 'down') {
    start(() => moveTask(task.id, direction, [...siblings]));
  }

  /** A row can be reordered when it is in a pile and still on the list. */
  const sortable = index !== -1 && !done && !dropped;
  /** Whether the task crossing this row is one this row could catch. */
  const catching = dragging !== null && dragging !== task.id && siblings.includes(dragging);

  function onDragOver(event: React.DragEvent) {
    if (!sortable || !catching) return;
    // Only a preventDefault here makes the row a drop target at all.
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    setEdge(event.clientY < box.top + box.height * 0.5 ? 'top' : 'bottom');
  }

  function onDrop(event: React.DragEvent) {
    if (!sortable) return;
    event.preventDefault();
    const moved = event.dataTransfer.getData('text/plain');
    setEdge(null);
    if (!moved || moved === task.id || !siblings.includes(moved)) return;
    // Above this row, or above whatever is under it -- and null at the foot,
    // where there is nothing to be above.
    const before = edge === 'top' ? task.id : (siblings[index + 1] ?? null);
    if (before === moved) return;
    start(() => placeTask(moved, before, [...siblings]));
  }

  return (
    <div
      // The handle a link from elsewhere lands on: /todo#task-<id> from the
      // front page, so "the thing due today" on home is one click from the row
      // that can actually be ticked off. `scroll-mt` keeps it clear of the
      // sticky top bar, which would otherwise land it just under the header.
      id={`task-${task.id}`}
      className={cn(
        'group row-pad relative flex scroll-mt-24 items-start gap-3',
        pending && 'opacity-50',
        grabbed && 'opacity-40',
      )}
      draggable={grabbed}
      onDragStart={(event) => {
        dragging = task.id;
        event.dataTransfer.setData('text/plain', task.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => {
        dragging = null;
        setGrabbed(false);
        setEdge(null);
      }}
      onDragOver={onDragOver}
      onDragLeave={() => setEdge(null)}
      onDrop={onDrop}
    >
      {/* Where it would land. A line rather than a gap, so nothing below it
          moves while the pointer is still deciding. */}
      {edge && (
        <span
          className={cn(
            'pointer-events-none absolute inset-x-0 h-0.5 rounded-full bg-accent',
            edge === 'top' ? 'top-0' : 'bottom-0',
          )}
          aria-hidden
        />
      )}

      {/* The grip, on the row's own margin, appearing under the pointer.
          Hidden where there is no pointer to hover with: a touch screen
          cannot drag this and keeps the arrows on the right instead. */}
      <span
        className="-ml-1 mt-0.5 hidden w-3 shrink-0 justify-center [@media(hover:hover)]:flex"
        aria-hidden
      >
        {sortable && (
          <GripVertical
            className={cn(
              'size-4 cursor-grab text-ink-ghost opacity-0 transition-opacity duration-150 group-hover:opacity-100',
              grabbed && 'cursor-grabbing opacity-100',
            )}
            strokeWidth={1.75}
            onMouseDown={() => setGrabbed(true)}
            onMouseUp={() => setGrabbed(false)}
          />
        )}
      </span>

      {/* The glyph is the state and the button is the hit area, which is why
          the bordered box went: a border round a shape that already says open
          is the same claim twice. A dropped task gets the struck hexagon here
          rather than nothing at all -- it used to be findable only by reading
          the title's strike-through. */}
      <button
        type="button"
        aria-label={done ? 'Reopen' : 'Mark done'}
        onClick={() => (done ? start(() => reopenTask(task.id)) : complete())}
        className={cn(
          'press mt-0.5 flex size-[18px] shrink-0 items-center justify-center transition-colors duration-150',
          done
            ? 'text-status-offer'
            : dropped
              ? 'text-ink-muted'
              : 'text-ink-muted hover:text-accent',
        )}
      >
        <StatusGlyph glyph={TASK_STATUS_GLYPHS[task.status]} size={16} />
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cn(
              'text-left text-ui font-medium text-ink transition-colors duration-150 hover:text-accent',
              (done || dropped) && 'text-ink-muted line-through',
            )}
          >
            {task.title}
          </button>

          {task.pinned && !done && !dropped && (
            <Pin className="size-3 text-accent" strokeWidth={1.75} aria-label="Pinned" />
          )}

          <DueLabel task={task} timezone={timezone} />

          {anchor && (
            <a
              href={anchor.href}
              className="truncate text-small text-ink-muted underline decoration-border underline-offset-2 transition-colors duration-150 hover:text-accent"
            >
              {anchor.label}
            </a>
          )}

          {dropped && <span className="text-small text-ink-muted">dropped</span>}
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
            {/* The arrows are how a task moves without a pointer: a touch
                screen cannot drag the grip, and neither can a keyboard. So
                they stand down where there is a pointer -- but come back the
                moment focus lands in the row, because a control that only a
                mouse can reach is a control some people do not have.

                Only where there is somewhere to go: an arrow at the top of a
                pile that does nothing is a control that lies. */}
            <span className="contents [@media(hover:hover)]:hidden [@media(hover:hover)]:group-focus-within:contents">
              {index > 0 && (
                <IconButton label="Move up" onClick={() => move('up')}>
                  <ArrowUp className="size-3.5" strokeWidth={1.75} aria-hidden />
                </IconButton>
              )}
              {index !== -1 && index < siblings.length - 1 && (
                <IconButton label="Move down" onClick={() => move('down')}>
                  <ArrowDown className="size-3.5" strokeWidth={1.75} aria-hidden />
                </IconButton>
              )}
            </span>
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
              <IconButton label="Later" onClick={later}>
                <Clock className="size-3.5" strokeWidth={1.75} aria-hidden />
              </IconButton>
            )}
            <IconButton label="Drop" onClick={drop}>
              <X className="size-3.5" strokeWidth={1.75} aria-hidden />
            </IconButton>
          </>
        )}

        {(done || dropped) && (
          <>
            <IconButton label="Reopen" onClick={() => start(() => reopenTask(task.id))}>
              <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden />
            </IconButton>
            <ConfirmStep
              prompt="Deletes this task for good. Dropping it keeps it in the archive."
              confirmLabel="Delete"
              pendingLabel="Deleting…"
              onConfirm={() => removeTask(task.id)}
              className="size-8 px-0 text-ink-muted hover:bg-sunken hover:text-ink"
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden />
              <span className="sr-only">Delete</span>
            </ConfirmStep>
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
      className="press flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
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
