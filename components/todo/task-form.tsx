'use client';

import { useActionState, useRef, useState } from 'react';
import { Pin, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Field, FieldError, Input, Textarea } from '@/components/ui/field';
import { addTask, editTask, type TaskFormState } from '@/app/todo/actions';
import { addDays, type Task } from '@/lib/todo/tasks/model';

/**
 * One line, and the rest only when you want it.
 *
 * The friction that kills a todo list is the form: if writing something down
 * costs a date picker and three fields, it does not get written down. So the
 * whole thing collapses to a title and a button, and everything else is behind
 * "Details".
 *
 * Today and tomorrow are the exception that earns its own control. They are
 * most of what anyone ever puts in the date field, and reaching them through
 * "Details" and a date picker is three clicks and a calendar to say a word.
 * `today` is the account's own day, worked out on the server: the browser's
 * idea of today is a different day for anyone whose zone is not the one they
 * keep their list in.
 */
export function AddTask({ today }: { today: string }) {
  const [noting, setNoting] = useState(false);
  const [dueOn, setDueOn] = useState('');
  const [time, setTime] = useState('');
  const [pinned, setPinned] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const tomorrow = addDays(today, 1);

  // Clearing the form after a successful add happens here rather than in an
  // effect watching the returned message. An effect cannot tell two successive
  // adds apart -- the message is the same string both times -- so it either
  // fires once and then stops, or needs a nonce to make it fire again. Doing it
  // where the result actually arrives needs neither.
  const [state, action, pending] = useActionState<TaskFormState, FormData>(
    async (prev, formData) => {
      const result = await addTask(prev, formData);
      if (result.message) {
        formRef.current?.reset();
        // The date, the hour and the pin are held here rather than by the
        // form, so the form's own reset does not reach them.
        setDueOn('');
        setTime('');
        setPinned(false);
        setNoting(false);
        titleRef.current?.focus();
      }
      return result;
    },
    {},
  );

  return (
    <form ref={formRef} action={action} className={cardVariants({ padding: 'dense' })}>
      <div className="flex items-center gap-2">
        {/* One control, not a form: what has to happen, and when, on the line
            you are already typing on. The two were a text box and a date
            picker two rows apart behind a Details toggle, which is three
            controls and a fold to write down "Thursday". */}
        <div
          className={cn(
            'flex h-(--control-h) min-w-0 flex-1 items-center gap-1 rounded-control border border-control bg-surface px-(--control-px)',
            'focus-within:border-accent focus-within:ring-1 focus-within:ring-accent/40',
          )}
        >
          <input
            ref={titleRef}
            name="title"
            placeholder="What has to happen?"
            aria-label="What has to happen?"
            required
            // eslint-disable-next-line no-restricted-syntax -- text-base is the one deliberate off-scale size: 16px stops iOS zooming on focus.
            className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-ghost sm:text-ui"
          />
          <input
            type="date"
            name="dueOn"
            aria-label="Due"
            value={dueOn}
            onChange={(event) => {
              setDueOn(event.target.value);
              // A time with no day is not a due date at all; see resolveDue.
              if (!event.target.value) setTime('');
            }}
            className="tabular shrink-0 bg-transparent text-small text-ink-muted outline-none"
          />
          {/* The hour, only once there is a day for it to be an hour of. */}
          {dueOn && (
            <input
              type="time"
              name="dueTime"
              aria-label="At"
              value={time}
              onChange={(event) => setTime(event.target.value)}
              className="tabular shrink-0 bg-transparent text-small text-ink-muted outline-none"
            />
          )}
        </div>

        <Button type="submit" disabled={pending}>
          <Plus className="size-4" strokeWidth={1.75} aria-hidden />
          Add
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <QuickDay label="Today" day={today} value={dueOn} onPick={setDueOn} />
        <QuickDay label="Tomorrow" day={tomorrow} value={dueOn} onPick={setDueOn} />

        <button
          type="button"
          aria-pressed={pinned}
          onClick={() => setPinned((on) => !on)}
          title={pinned ? 'Pinned to the top' : 'Pin to the top'}
          className={cn(
            'press flex size-7 items-center justify-center rounded-full transition-colors duration-150',
            pinned ? 'bg-accent text-surface' : 'text-ink-muted hover:bg-accent-tint hover:text-accent',
          )}
        >
          <Pin className="size-3.5" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">{pinned ? 'Pinned to the top' : 'Pin to the top'}</span>
        </button>
        <input type="hidden" name="pinned" value={pinned ? 'on' : ''} />

        {/* One button for the one thing that genuinely needs its own room,
            in place of a Details fold over three fields that did not. */}
        <button
          type="button"
          onClick={() => setNoting((open) => !open)}
          className="ml-auto text-ui font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          {noting ? 'Hide note' : 'Add note'}
        </button>
      </div>

      {/* Hidden rather than unmounted, so a note typed and then folded away is
          still there and is still submitted. */}
      <div className={cn('mt-2', !noting && 'hidden')}>
        <Textarea id="add-body" name="body" rows={2} aria-label="Note" placeholder="Anything else." />
      </div>

      <FieldError>{state.error}</FieldError>
    </form>
  );
}

export function EditTask({ task, onDone }: { task: Task; onDone: () => void }) {
  const [state, action, pending] = useActionState<TaskFormState, FormData>(
    async (prev, formData) => {
      const result = await editTask(prev, formData);
      if (result.message) onDone();
      return result;
    },
    {},
  );

  return (
    // Not a card: an editor that opens in place of a row sits on the canvas
    // tone so it reads as the row unfolded, not as a second sheet.
    <form action={action} className="space-y-3 rounded-lg border border-border bg-canvas p-3">
      <input type="hidden" name="id" value={task.id} />
      <Field id={`title-${task.id}`} label="Title">
        <Input id={`title-${task.id}`} name="title" defaultValue={task.title} required />
      </Field>

      <DueFields
        defaultDay={task.dueOn ?? (task.dueAt ? task.dueAt.slice(0, 10) : '')}
        defaultTime={task.dueAt ? clockOf(task.dueAt) : ''}
      />

      <Field id={`body-${task.id}`} label="Notes">
        <Textarea id={`body-${task.id}`} name="body" rows={3} defaultValue={task.body ?? ''} />
      </Field>

      <PinnedField id={`pinned-${task.id}`} defaultChecked={task.pinned} />

      <FieldError>{state.error}</FieldError>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * A day, and optionally a time.
 *
 * Two inputs rather than one datetime-local, because the difference between
 * them is the difference between the two columns: a day with no time is a day
 * and never moves, and a day with a time is an instant. A single control cannot
 * express "Tuesday, no particular hour" at all.
 */
function DueFields({
  defaultDay = '',
  defaultTime = '',
}: {
  defaultDay?: string;
  defaultTime?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="dueOn" label="Due">
        <Input id="dueOn" name="dueOn" type="date" defaultValue={defaultDay} />
      </Field>
      <Field id="dueTime" label="At (optional)" hint="Leave empty for a day with no particular hour.">
        <Input id="dueTime" name="dueTime" type="time" defaultValue={defaultTime} />
      </Field>
    </div>
  );
}

function PinnedField({ id, defaultChecked = false }: { id: string; defaultChecked?: boolean }) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-ui text-ink">
      <input
        id={id}
        type="checkbox"
        name="pinned"
        defaultChecked={defaultChecked}
        className="size-4 accent-accent"
      />
      Pin to the top
    </label>
  );
}

/**
 * A day you can set in one click, and unset in a second one.
 *
 * A toggle rather than a pair of radio buttons: picking Today and then
 * changing your mind has to be possible without opening the date field to
 * clear it.
 */
function QuickDay({
  label,
  day,
  value,
  onPick,
}: {
  label: string;
  day: string;
  value: string;
  onPick: (value: string) => void;
}) {
  const on = value === day;

  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onPick(on ? '' : day)}
      className={cn(
        'press rounded-full px-2.5 py-1 text-small font-medium transition-colors duration-150',
        on ? 'bg-accent text-surface' : 'text-ink-muted hover:bg-accent-tint hover:text-accent',
      )}
    >
      {label}
    </button>
  );
}

/** The HH:MM a stored instant shows as, in the browser's own zone. */
function clockOf(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}
