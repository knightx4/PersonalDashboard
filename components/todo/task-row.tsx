'use client';

import { useOptimistic, useState, useTransition } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Clock,
  GripVertical,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { TASK_STATUS_GLYPHS } from '@/lib/status-glyphs';
import { useToast, type ToastInput } from '@/components/ui/toast';
import {
  addItem,
  bringBackTask,
  completeTask,
  dropTask,
  laterTask,
  moveTask,
  pinTask,
  placeTask,
  removeTask,
  renameTaskAction,
  reopenTask,
  rescheduleTaskAction,
  unpointTask,
} from '@/app/todo/actions';
import { openCount, SNOOZE_DAYS, type Task, type TaskStatus } from '@/lib/todo/tasks/model';
import { InlineInput } from '@/components/ui/field';
import { clockIn, dayIn } from '@/lib/todo/time';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import { TaskAbout } from './task-about';
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

/**
 * How many items are shown without being asked for.
 *
 * A list longer than this starts folded, because a task with twelve things
 * under it pushes everything else on the agenda off the screen. A shorter one
 * is already shorter than the control that would hide it.
 */
const SHORT_LIST = 6;

/**
 * One row action: how the row should look at once, and the write behind it.
 *
 * The patch and the write are handed over together because they are the same
 * decision -- "this task is done now" is both a checkbox that fills and a call
 * to completeTask -- and holding them apart is how a row ends up drawing a
 * change it never sent.
 */
type RowWrite = {
  patch: Partial<Task>;
  write: () => Promise<{ error: string | null }>;
  /** Said once the write is through, with the way back in it. */
  toast?: ToastInput;
};

/** What "later" does to the row until the server says when. Only the button
 * reads it: a snoozed task shows "Bring back" where an open one shows "Later".
 */
function snoozedFrom(now: number): string {
  return new Date(now + SNOOZE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The way back, as the toast wants it.
 *
 * The toast reads a thrown error as "could not undo that", and the actions
 * hand their error back instead of throwing, so it is turned back into one
 * here rather than the undo quietly reporting success.
 */
function undoWith(write: () => Promise<{ error: string | null }>): () => Promise<void> {
  return async () => {
    const { error } = await write();
    if (error) throw new Error(error);
  };
}

export function TaskRow({
  task: serverTask,
  timezone,
  anchor,
  pile,
  items = [],
  under,
}: {
  task: Task;
  timezone: string;
  /** What the task is about, when the list is not already inside that thing. */
  anchor?: { label: string; href: string } | null;
  /**
   * The smaller todos written under this task, ticked ones included.
   *
   * Empty on a list that does not gather them -- the archive is a history and
   * shows every row in its own right, so nothing is nested there.
   */
  items?: Task[];
  /**
   * The task this one sits under, where the list is flat.
   *
   * The archive is a history and shows every row in its own right, so an item
   * there says what it came out of instead of being nested under it. Absent on
   * the agenda, where the nesting says it.
   */
  under?: { label: string; href: string } | null;
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
  /** Whether the box for writing the next item is open under this task. */
  const [adding, setAdding] = useState(false);
  /** The anchor finder on a narrow row, which has no button of its own. */
  const [aboutOpen, setAboutOpen] = useState(false);
  const [pending, start] = useTransition();
  const [grabbed, setGrabbed] = useState(false);
  /** Which edge of this row the dragged task would land on, while it is over. */
  const [edge, setEdge] = useState<'top' | 'bottom' | null>(null);
  const toast = useToast();

  /**
   * The checkbox, the pin and the snooze, drawn before the round trip.
   *
   * All three used to wait for the write and the revalidation that follows it,
   * which is a fifth of a second of a checkbox that does not fill. `task` below
   * is the row as it should look now; a refused write leaves the task the
   * server rendered, so the row goes back on its own.
   */
  const {
    shown: task,
    run,
    failed,
  } = useOptimisticWrite<Task, RowWrite>({
    value: serverTask,
    apply: (current, change) => ({ ...current, ...change.patch }),
    write: (change) => change.write(),
    onDone: (change) => {
      if (change.toast) toast(change.toast);
    },
  });

  // A pile of one has no order to change.
  const siblings = pile && pile.length > 1 ? pile : [];
  const index = siblings.indexOf(task.id);

  if (editing) return <EditTask task={task} onDone={() => setEditing(false)} />;

  const done = task.status === 'done';
  const dropped = task.status === 'dropped';

  /**
   * Run one of the writes the row does not draw ahead of: a move, a place, a
   * delete. Each returns its error rather than throwing, and a row that
   * ignored that would look like the write had worked.
   */
  function act(write: () => Promise<{ error: string | null }>) {
    start(async () => {
      const { error } = await write();
      if (error) toast({ text: error });
    });
  }

  function complete() {
    // Which items the tick took down with it, filled in by the write and read
    // by the undo. The toast is built before the write returns, so the way
    // back cannot be handed the ids -- it is handed the array they land in.
    // Items already ticked are not among them and stay as they were.
    const ticked: string[] = [];

    run({
      patch: { status: 'done' },
      write: async () => {
        const result = await completeTask(task.id);
        ticked.push(...result.items);
        return result;
      },
      toast: {
        text: 'done',
        undo: undoWith(() => reopenTask(task.id, ticked)),
        undone: 'reopened',
      },
    });
  }

  function drop() {
    run({
      patch: { status: 'dropped' },
      write: () => dropTask(task.id),
      // reopenTask is the inverse of a drop: bringBackTask undoes a snooze.
      toast: {
        text: 'dropped',
        undo: undoWith(() => reopenTask(task.id)),
        undone: 'back on the list',
      },
    });
  }

  function later() {
    run({
      patch: { snoozedUntil: snoozedFrom(Date.now()) },
      write: () => laterTask(task.id),
      toast: {
        text: 'until later',
        undo: undoWith(() => bringBackTask(task.id)),
        undone: 'brought back',
      },
    });
  }

  function move(direction: 'up' | 'down') {
    act(() => moveTask(task.id, direction, [...siblings]));
  }

  /**
   * Everything the narrow row does not have space to draw, in the order the
   * icon row draws it. Same writes, same wording as the buttons' own labels --
   * a control that changes name when it moves into a menu is a second control
   * to learn. An arrow with nowhere to go is left out here exactly as it is
   * left out there.
   */
  const moreActions: ActionMenuItem[] = [
    ...(index > 0 ? [{ id: 'up', label: 'Move up', onSelect: () => move('up') }] : []),
    ...(index !== -1 && index < siblings.length - 1
      ? [{ id: 'down', label: 'Move down', onSelect: () => move('down') }]
      : []),
    {
      id: 'pin',
      label: task.pinned ? 'Unpin' : 'Pin',
      onSelect: () => run({ patch: { pinned: !task.pinned }, write: () => pinTask(task.id, !task.pinned) }),
    },
    task.snoozedUntil
      ? {
          id: 'back',
          label: 'Bring back',
          onSelect: () => run({ patch: { snoozedUntil: null }, write: () => bringBackTask(task.id) }),
        }
      : { id: 'later', label: 'Later', onSelect: later },
    { id: 'add', label: 'Add an item', onSelect: () => setAdding(true) },
    {
      id: 'about',
      label: anchor ? 'Point it at something else' : 'What is this about?',
      onSelect: () => setAboutOpen(true),
    },
    ...(anchor
      ? [
          {
            id: 'unlink',
            label: 'Not about anything',
            onSelect: () => act(() => unpointTask(task.id)),
          },
        ]
      : []),
  ];

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
    act(() => placeTask(moved, before, [...siblings]));
  }

  return (
    <div>
      <div
        // The handle a link from elsewhere lands on: /todo#task-<id> from the
        // front page, so "the thing due today" on home is one click from the row
        // that can actually be ticked off. `scroll-mt` keeps it clear of the
        // sticky top bar, which would otherwise land it just under the header.
        id={`task-${task.id}`}
        className={cn(
          'group row-pad relative flex scroll-mt-24 items-start gap-3',
          // Only the writes the row waits on dim it. An optimistic one is drawn
          // as though it were already true, so dimming it would say the opposite.
          pending && 'opacity-50',
          grabbed && 'opacity-40',
          failed && 'bg-danger-tint',
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
          onClick={() =>
            done ? run({ patch: { status: 'open' }, write: () => reopenTask(task.id) }) : complete()
          }
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
            <TaskTitle
              task={task}
              struck={done || dropped}
              onSave={(title) =>
                run({
                  patch: { title },
                  write: () => renameTaskAction(task.id, title),
                })
              }
            />

            {task.pinned && !done && !dropped && (
              <Pin className="size-3 text-accent" strokeWidth={1.75} aria-label="Pinned" />
            )}

            <DueLabel
              task={task}
              timezone={timezone}
              onSave={(day, time) =>
                run({
                  // Drawn before the write lands, which needs the two columns
                  // resolved here the way `resolveDue` resolves them on the
                  // server: a day with a time is an instant and clears the
                  // plain date, a day without one is a date and clears the
                  // instant. Getting this wrong would show the old date for
                  // the fifth of a second before the revalidation, which is
                  // exactly the flicker drawing ahead exists to avoid.
                  patch: {
                    dueOn: day && !time ? day : null,
                    dueAt: day && time ? `${day}T${time}:00` : null,
                  },
                  write: () => rescheduleTaskAction(task.id, day, time),
                })
              }
            />

            {anchor && (
              <a
                href={anchor.href}
                className="truncate text-small text-ink-muted underline decoration-border underline-offset-2 transition-colors duration-150 hover:text-accent"
              >
                {anchor.label}
              </a>
            )}

            {under && (
              <span className="truncate text-small text-ink-muted">
                in{' '}
                <a
                  href={under.href}
                  className="underline decoration-border underline-offset-2 transition-colors duration-150 hover:text-accent"
                >
                  {under.label}
                </a>
              </span>
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
          act on.

          Which is also why the two widths are not the same set. On a pointer
          these eight are invisible until the row is pointed at, so they cost
          the page nothing; on a phone they are all on screen, all the time,
          against a title that has to share the line with them -- eight icons
          and a task you can no longer read. Narrow gets the three that earn
          the room, and everything else moves into one menu behind them.
          Law 9. */}
        <div className="flex shrink-0 items-center gap-0.5 opacity-100 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
          {!done && !dropped && (
            <span className="hidden sm:contents">
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
                onClick={() =>
                  run({
                    patch: { pinned: !task.pinned },
                    write: () => pinTask(task.id, !task.pinned),
                  })
                }
              >
                <Pin className="size-3.5" strokeWidth={1.75} aria-hidden />
              </IconButton>
              {task.snoozedUntil ? (
                <IconButton
                  label="Bring back"
                  onClick={() =>
                    run({ patch: { snoozedUntil: null }, write: () => bringBackTask(task.id) })
                  }
                >
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
              {/* Breaking the task up: the box opens under the row, where the
                list is. Hidden with the rest of the actions until the row is
                pointed at, so a task with no list looks as it always did. */}
              <IconButton label="Add an item" onClick={() => setAdding(true)}>
                <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
              </IconButton>
              {/* The whole form, for the parts of a task the row does not
                show: the notes, and a date given to a task that has none.
                The title and an existing date are edited in the row itself,
                which is what this used to be the only way to do. */}
              <IconButton label="Edit everything" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden />
              </IconButton>
              {/* Last in the group, because it is the one action here that opens
                something rather than doing something. `anchor` is what the
                page resolved, so the unlink half only appears where there is
                a link to remove. */}
              <TaskAbout taskId={task.id} linked={Boolean(anchor)} />
            </span>
          )}

          {/* The same row on a phone: drop, edit, and the rest behind the three
            dots. Those two are out here rather than in the menu because they
            are what a task gets once it is no longer just a checkbox --
            everything else is a second thought, and reads fine one press
            further away. */}
          {!done && !dropped && (
            <span className="flex items-center gap-0.5 sm:hidden">
              <IconButton label="Drop" onClick={drop}>
                <X className="size-3.5" strokeWidth={1.75} aria-hidden />
              </IconButton>
              <IconButton label="Edit everything" onClick={() => setEditing(true)}>
                <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden />
              </IconButton>
              <ActionMenu label="More actions" items={moreActions} />
              {/* Drawn with no trigger of its own -- the menu above opens it. */}
              <TaskAbout
                taskId={task.id}
                linked={Boolean(anchor)}
                open={aboutOpen}
                onOpenChange={setAboutOpen}
              />
            </span>
          )}

          {(done || dropped) && (
            <>
              <IconButton
                label="Reopen"
                onClick={() => run({ patch: { status: 'open' }, write: () => reopenTask(task.id) })}
              >
                <RotateCcw className="size-3.5" strokeWidth={1.75} aria-hidden />
              </IconButton>
              <ConfirmStep
                prompt="Deletes this task for good. Dropping it keeps it in the archive."
                confirmLabel="Delete"
                pendingLabel="Deleting…"
                onConfirm={async () => {
                  const { error } = await removeTask(task.id);
                  if (error) toast({ text: error });
                }}
                className="size-8 px-0 text-ink-muted hover:bg-sunken hover:text-ink"
              >
                <Trash2 className="size-3.5" strokeWidth={1.75} aria-hidden />
                <span className="sr-only">Delete</span>
              </ConfirmStep>
            </>
          )}
        </div>
      </div>

      {/* The list, under the task it belongs to. Nothing at all when there is
          none and nothing is being written, so a task without one reads
          exactly as it did before any of this existed. */}
      {(items.length > 0 || adding) && (
        <TaskItems
          parentId={task.id}
          items={items}
          adding={adding}
          onDoneAdding={() => setAdding(false)}
        />
      )}
    </div>
  );
}

/**
 * The smaller todos under one task.
 *
 * The count and the rows are held here rather than in the row above, because
 * ticking an item has to move the count in the same breath: a "2 of 5" that
 * waits for the server has already told you the wrong number. The optimistic
 * list is what both read.
 *
 * The rows are quieter than the task above them -- no pin, no drag, no Later.
 * An item that can be deferred away from the thing it belongs to is a task in
 * its own right, and writing it here was the wrong place for it.
 */
function TaskItems({
  parentId,
  items: serverItems,
  adding,
  onDoneAdding,
}: {
  parentId: string;
  items: Task[];
  adding: boolean;
  onDoneAdding: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [items, change] = useOptimistic(
    serverItems,
    (current: Task[], patch: { id: string; status: TaskStatus }) =>
      patch.status === 'dropped'
        ? current.filter((item) => item.id !== patch.id)
        : current.map((item) => (item.id === patch.id ? { ...item, status: patch.status } : item)),
  );
  // A long list starts folded away; a short one is shorter than the control
  // that would hide it.
  const [open, setOpen] = useState(serverItems.length <= SHORT_LIST);

  const left = openCount(items);
  const expanded = open || adding;

  function write(
    id: string,
    status: TaskStatus,
    run: () => Promise<{ error: string | null }>,
    said?: ToastInput,
  ) {
    start(async () => {
      change({ id, status });
      const { error } = await run();
      if (error) {
        toast({ text: error });
        return;
      }
      if (said) toast(said);
    });
  }

  return (
    <div className={cn('pb-2 pl-9 pr-3', pending && 'opacity-50')}>
      {items.length > 0 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setOpen(!expanded)}
          className="press flex items-center gap-1 rounded-lg py-0.5 text-small text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          {expanded ? (
            <ChevronDown className="size-3.5" strokeWidth={1.75} aria-hidden />
          ) : (
            <ChevronRight className="size-3.5" strokeWidth={1.75} aria-hidden />
          )}
          <span className="tabular">
            {items.length - left} of {items.length}
          </span>
          <span>done</span>
        </button>
      )}

      {expanded && items.length > 0 && (
        <ul className="mt-0.5 space-y-0.5">
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              onTick={() =>
                write(item.id, item.status === 'done' ? 'open' : 'done', () =>
                  item.status === 'done' ? reopenTask(item.id) : completeTask(item.id),
                )
              }
              onDrop={() =>
                write(item.id, 'dropped', () => dropTask(item.id), {
                  text: 'removed',
                  undo: undoWith(() => reopenTask(item.id)),
                  undone: 'back on the list',
                })
              }
            />
          ))}
        </ul>
      )}

      {adding && <AddItem parentId={parentId} onClose={onDoneAdding} />}
    </div>
  );
}

/** One item: a box to tick, what it says, and the way to take it off. */
function ItemRow({ item, onTick, onDrop }: { item: Task; onTick: () => void; onDrop: () => void }) {
  const done = item.status === 'done';

  return (
    <li className="group/item flex items-start gap-2">
      <button
        type="button"
        aria-label={done ? 'Reopen' : 'Mark done'}
        onClick={onTick}
        className={cn(
          'press mt-0.5 flex size-4 shrink-0 items-center justify-center transition-colors duration-150',
          done ? 'text-status-offer' : 'text-ink-muted hover:text-accent',
        )}
      >
        <StatusGlyph glyph={TASK_STATUS_GLYPHS[item.status]} size={14} />
      </button>

      <span
        className={cn(
          'min-w-0 flex-1 break-words text-small text-ink',
          done && 'text-ink-muted line-through',
        )}
      >
        {item.title}
      </span>

      <button
        type="button"
        title="Remove"
        onClick={onDrop}
        className="press flex size-6 shrink-0 items-center justify-center rounded-lg text-ink-muted opacity-100 transition-colors duration-150 hover:bg-sunken hover:text-ink sm:opacity-0 sm:group-focus-within/item:opacity-100 sm:group-hover/item:opacity-100"
      >
        <X className="size-3" strokeWidth={1.75} aria-hidden />
        <span className="sr-only">Remove</span>
      </button>
    </li>
  );
}

/**
 * The box for the next item.
 *
 * It stays open after a write, because items are written in threes and fours
 * and closing it would make the second one cost another click. Escape and an
 * empty Enter are both ways out.
 */
function AddItem({ parentId, onClose }: { parentId: string; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [pending, start] = useTransition();
  const toast = useToast();

  function submit() {
    const text = title.trim();
    if (!text) {
      onClose();
      return;
    }

    start(async () => {
      const { error } = await addItem(parentId, text);
      if (error) {
        toast({ text: error });
        return;
      }
      setTitle('');
    });
  }

  return (
    <form
      className="mt-1 flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <Plus className="size-3.5 shrink-0 text-ink-ghost" strokeWidth={1.75} aria-hidden />
      <input
        autoFocus
        value={title}
        disabled={pending}
        aria-label="Add an item"
        placeholder="Add an item"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        onBlur={() => {
          if (!title.trim()) onClose();
        }}
        className="min-w-0 flex-1 border-none bg-transparent p-0 text-small text-ink outline-none placeholder:text-ink-ghost"
      />
    </form>
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
/**
 * The title, typed where it is read.
 *
 * It used to be a button that swapped the whole row for a form with four
 * fields and a Save button, to change the one string you were already looking
 * at. Law 12: a value and its editor are the same object in the same place at
 * the same size. `InlineInput` is that component, and this is a task's title
 * in it.
 *
 * Enter and blur both commit, because both mean "done with this"; Escape puts
 * the old words back. A title emptied is refused rather than saved, since a
 * task with no title cannot be found again -- the row simply goes back to what
 * it was, which is what somebody who selected all and hit delete meant to
 * undo anyway.
 */
function TaskTitle({
  task,
  struck,
  onSave,
}: {
  task: Task;
  struck: boolean;
  onSave: (title: string) => void;
}) {
  const [draft, setDraft] = useState(task.title);

  // The saved title wins when it changes underneath -- a rename in another
  // tab, or the server render after this one's own write. Re-seeded during
  // render, the way the rest of the app does it.
  const [seed, setSeed] = useState(task.title);
  if (seed !== task.title) {
    setSeed(task.title);
    setDraft(task.title);
  }

  function commit() {
    const next = draft.trim();
    if (!next || next === task.title) {
      setDraft(task.title);
      return;
    }
    onSave(next);
  }

  return (
    <InlineInput
      value={draft}
      aria-label="Title"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setDraft(task.title);
          // Blur after the reset, so the commit on the way out sees the old
          // words and does nothing.
          requestAnimationFrame(() => event.currentTarget?.blur());
        }
      }}
      className={cn(
        'w-full max-w-full text-ui font-medium text-ink',
        struck && 'text-ink-muted line-through',
      )}
    />
  );
}

/**
 * When it is due, changed where it is read.
 *
 * The same law as the title one line up, and the same complaint in the same
 * note: the date was a label, and moving a task by a day meant opening the
 * form. It is a date input sitting in the row now, at the size of the text it
 * replaces, and a task with a time carries a time field beside it.
 *
 * A task with no date at all still shows nothing (law 1) -- an empty date
 * field on every undated row would be an editor drawn over nothing, which is
 * law 14. The form is still where a date is first given.
 */
function DueLabel({
  task,
  timezone,
  onSave,
}: {
  task: Task;
  timezone: string;
  onSave: (day: string, time: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  if (!task.dueOn && !task.dueAt) return null;

  // What the two fields start on. `dueAt` is an instant, so the day and the
  // clock it reads as are the reader's, not UTC's -- the same zone the label
  // beside it is formatted in.
  const day = task.dueAt ? dayIn(task.dueAt, timezone) : (task.dueOn ?? '');
  const time = task.dueAt ? clockIn(task.dueAt, timezone) : '';

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          type="date"
          autoFocus
          aria-label="Due date"
          defaultValue={day}
          onChange={(event) => {
            setEditing(false);
            onSave(event.target.value, event.target.value ? time : '');
          }}
          className="tabular rounded-control bg-sunken px-1 py-0.5 text-small text-ink"
        />
        {time && (
          <input
            type="time"
            aria-label="Due time"
            defaultValue={time}
            onChange={(event) => {
              setEditing(false);
              onSave(day, event.target.value);
            }}
            className="tabular rounded-control bg-sunken px-1 py-0.5 text-small text-ink"
          />
        )}
      </span>
    );
  }

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

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      title="Change when it is due"
      className="tabular press rounded-control px-1 py-0.5 text-small text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink"
    >
      {text}
    </button>
  );
}
