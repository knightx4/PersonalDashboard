'use client';

import { useActionState, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Field, FieldError, Input, Textarea } from '@/components/ui/field';
import { addTask, editTask, type TaskFormState } from '@/app/todo/actions';
import type { Task } from '@/lib/todo/tasks/model';

/**
 * One line, and the rest only when you want it.
 *
 * The friction that kills a todo list is the form: if writing something down
 * costs a date picker and three fields, it does not get written down. So the
 * whole thing collapses to a title and a button, and everything else is behind
 * "Details".
 */
export function AddTask() {
  const [expanded, setExpanded] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

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

      {/* Deliberately quiet rather than accent-coloured: the whole point of the
          form is that you do not need what is behind this. */}
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="mt-2 text-ui font-medium text-ink-muted transition-colors duration-150 hover:text-ink"
      >
        {expanded ? 'Less' : 'Details'}
      </button>

      {/* Rendered either way so a due date typed before expanding is still
          submitted, and hidden rather than unmounted so nothing is lost when
          the section is collapsed again. */}
      <div className={cn('mt-3 space-y-3', !expanded && 'hidden')}>
        <DueFields />
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
function DueFields({ defaultDay = '', defaultTime = '' }: { defaultDay?: string; defaultTime?: string }) {
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

/** The HH:MM a stored instant shows as, in the browser's own zone. */
function clockOf(iso: string): string {
  const at = new Date(iso);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}
