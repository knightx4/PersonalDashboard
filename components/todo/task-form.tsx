'use client';

import { useActionState, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
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
  const [expanded, setExpanded] = useState(false);
  const [dueOn, setDueOn] = useState('');
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
        // The date is held here rather than by the form, so the form's own
        // reset does not reach it.
        setDueOn('');
        setExpanded(false);
        titleRef.current?.focus();
      }
      return result;
    },
    {},
  );

  return (
    <form ref={formRef} action={action} className={cardVariants({ padding: 'dense' })}>
      <div className="flex items-center gap-2">
        <Input
          ref={titleRef}
          name="title"
          placeholder="What has to happen?"
          aria-label="What has to happen?"
          className="flex-1"
          required
        />
        <Button type="submit" disabled={pending}>
          <Plus className="size-4" strokeWidth={1.75} aria-hidden />
          Add
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <QuickDay label="Today" day={today} value={dueOn} onPick={setDueOn} />
        <QuickDay label="Tomorrow" day={tomorrow} value={dueOn} onPick={setDueOn} />

        {/* A date set any other way still has to be visible from out here,
            or collapsing Details would hide the fact that there is one. */}
        {dueOn && dueOn !== today && dueOn !== tomorrow && (
          <span className="text-small text-ink-muted">Due {dayLabel(dueOn)}</span>
        )}

        {/* Deliberately quiet rather than accent-coloured: the whole point of
            the form is that you do not need what is behind this. */}
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          className="ml-auto text-ui font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
        >
          {expanded ? 'Less' : 'Details'}
        </button>
      </div>

      {/* Rendered either way so a due date typed before expanding is still
          submitted, and hidden rather than unmounted so nothing is lost when
          the section is collapsed again. */}
      <div className={cn('mt-3 space-y-3', !expanded && 'hidden')}>
        <DueFields day={dueOn} onDayChange={setDueOn} />
        <Field id="add-body" label="Notes">
          <Textarea id="add-body" name="body" rows={3} />
        </Field>
        <PinnedField id="add-pinned" />
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
  day,
  onDayChange,
}: {
  defaultDay?: string;
  defaultTime?: string;
  /** Held by the caller, where a Today button can also set it. */
  day?: string;
  onDayChange?: (value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field id="dueOn" label="Due">
        {onDayChange ? (
          <Input
            id="dueOn"
            name="dueOn"
            type="date"
            value={day ?? ''}
            onChange={(event) => onDayChange(event.target.value)}
          />
        ) : (
          <Input id="dueOn" name="dueOn" type="date" defaultValue={defaultDay} />
        )}
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

/** A day as a person would read it, for the line that says one is set. */
function dayLabel(day: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${day}T00:00:00Z`));
}

/** The HH:MM a stored instant shows as, in the browser's own zone. */
function clockOf(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}
