'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, FieldError, Input, Textarea } from '@/components/ui/field';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { editTask, type TaskFormState } from '@/app/todo/actions';
import { type Task } from '@/lib/todo/tasks/model';

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
    // tone so it reads as the row unfolded, not as a second sheet. The well is
    // the whole of that claim -- the hairline it used to carry as well was a
    // third frame inside the card inside the row, saying nothing the recess
    // had not already said. Law 11.
    <form action={action} className="card-pad-dense space-y-3 rounded-card bg-canvas">
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
        <Button type="submit" pending={pending}>
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

/**
 * Pin, ticked with the same hexagon a task is.
 *
 * The browser's square box sat a few pixels from the row glyphs on /todo: one
 * page, one gesture, two shapes. The native input is still the control -- it
 * keeps the label, the focus and the form value -- and is only taken out of
 * sight, with the glyph drawn beside it and swapped on `:checked`. Nothing here
 * is JavaScript, so it ticks before the form hydrates.
 */
function PinnedField({ id, defaultChecked = false }: { id: string; defaultChecked?: boolean }) {
  return (
    <label htmlFor={id} className="group flex w-fit cursor-pointer items-center gap-2 text-ui text-ink">
      <Checkbox id={id} name="pinned" defaultChecked={defaultChecked} className="peer sr-only" />
      <StatusGlyph
        glyph="empty"
        size={16}
        className="text-ink-muted transition-colors duration-quick group-hover:text-accent peer-checked:hidden peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
      />
      <StatusGlyph
        glyph="check"
        size={16}
        className="hidden text-accent peer-checked:block peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
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
