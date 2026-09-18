'use client';

import { useActionState, useRef, useState } from 'react';
import { Pin, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Field, FieldError, Input, Textarea } from '@/components/ui/field';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { LinkPicker, type LinkChoice } from '@/components/todo/link-picker';
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
 *
 * What the task is about sits on the same row, as a chip. It is optional and
 * costs nothing when it is not used, which is the only way it could go on a
 * form whose whole argument is that writing something down has to be cheap.
 */
export function AddTask({ today }: { today: string }) {
  const [noting, setNoting] = useState(false);
  const [dueOn, setDueOn] = useState('');
  const [time, setTime] = useState('');
  const [pinned, setPinned] = useState(false);
  const [about, setAbout] = useState<LinkChoice | null>(null);
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
        setAbout(null);
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
        {/* The line you type on holds one thing: what has to happen. The date
            used to sit in here beside it, inside a shared frame -- but a
            native date input is the widest control a browser draws, and on a
            phone it took so much of the line that the title had barely room
            for two words. It has moved down to the day chips, which is where
            the answer to "when" is given anyway. */}
        <Input
          ref={titleRef}
          name="title"
          placeholder="What has to happen?"
          aria-label="What has to happen?"
          required
          className="min-w-0 flex-1"
        />

        <Button type="submit" disabled={pending}>
          <Plus className="size-4" strokeWidth={1.75} aria-hidden />
          Add
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <QuickDay label="Today" day={today} value={dueOn} onPick={setDueOn} />
        <QuickDay label="Tomorrow" day={tomorrow} value={dueOn} onPick={setDueOn} />

        {/* Any other day, right where the two easy ones are: the chips answer
            "when" and this is the same question asked in full. Unframed and
            quiet, so a row of chips stays a row of chips rather than growing a
            boxed field in the middle of it. */}
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
          className={cn(
            'tabular rounded-full bg-transparent px-2 py-1 text-small outline-none transition-colors duration-150',
            'focus:ring-1 focus:ring-accent/40',
            dueOn ? 'text-ink' : 'text-ink-muted',
          )}
        />
        {/* The hour, only once there is a day for it to be an hour of. */}
        {dueOn && (
          <input
            type="time"
            name="dueTime"
            aria-label="At"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className="tabular rounded-full bg-transparent px-2 py-1 text-small text-ink-muted outline-none transition-colors duration-150 focus:ring-1 focus:ring-accent/40"
          />
        )}

        {/* Beside the day rather than beside the title: both answer a
            question about the task that is not the task, and a title field
            with a second control inside it is the shape #137 decided against. */}
        <LinkPicker value={about} onChange={setAbout} />

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
      <input
        id={id}
        type="checkbox"
        name="pinned"
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <StatusGlyph
        glyph="empty"
        size={16}
        className="text-ink-muted transition-colors duration-150 group-hover:text-accent peer-checked:hidden peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
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
