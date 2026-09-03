'use client';

import { useActionState, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/field';
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
    <form ref={formRef} action={action} className="rounded-card border border-border bg-surface p-3">
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
          <Plus className="size-4" strokeWidth={2} aria-hidden />
          Add
        </Button>
      </div>

      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="mt-2 text-small font-medium text-ink-muted hover:text-ink"
      >
        {expanded ? 'Less' : 'Details'}
      </button>

      {/* Rendered either way so a due date typed before expanding is still
          submitted, and hidden rather than unmounted so nothing is lost when
          the section is collapsed again. */}
      <div className={cn('mt-3 space-y-3', !expanded && 'hidden')}>
        <DueFields />
        <div>
          <Label htmlFor="add-body">Notes</Label>
          <Textarea id="add-body" name="body" rows={3} />
        </div>
        <PinnedField id="add-pinned" />
      </div>

      {state.error && (
        <p className="mt-2 text-ui text-status-rejected">{state.error}</p>
      )}
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
    <form action={action} className="space-y-3 rounded-lg border border-border bg-canvas p-3">
      <input type="hidden" name="id" value={task.id} />
      <div>
        <Label htmlFor={`title-${task.id}`}>Title</Label>
        <Input id={`title-${task.id}`} name="title" defaultValue={task.title} required />
      </div>

      <DueFields
        defaultDay={task.dueOn ?? (task.dueAt ? task.dueAt.slice(0, 10) : '')}
        defaultTime={task.dueAt ? clockOf(task.dueAt) : ''}
      />

      <div>
        <Label htmlFor={`body-${task.id}`}>Notes</Label>
        <Textarea id={`body-${task.id}`} name="body" rows={3} defaultValue={task.body ?? ''} />
      </div>

      <PinnedField id={`pinned-${task.id}`} defaultChecked={task.pinned} />

      {state.error && <p className="text-ui text-status-rejected">{state.error}</p>}

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
      <div>
        <Label htmlFor="dueOn">Due</Label>
        <Input id="dueOn" name="dueOn" type="date" defaultValue={defaultDay} />
      </div>
      <div>
        <Label htmlFor="dueTime">At (optional)</Label>
        <Input id="dueTime" name="dueTime" type="time" defaultValue={defaultTime} />
        <p className="mt-1 text-micro text-ink-muted">
          Leave empty for a day with no particular hour.
        </p>
      </div>
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
        className="size-4 accent-[var(--color-accent)]"
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
