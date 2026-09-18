'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/cn';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FieldError, Input, Textarea } from '@/components/ui/field';
import {
  addEvent,
  editEvent,
  removeEvent,
  type EventFormState,
} from '@/app/todo/calendar/actions';

/**
 * What goes in the calendar: a title, when, and the two things you write down
 * about an appointment when you have them.
 *
 * One form for writing an event and for changing one, because they ask exactly
 * the same questions -- the only difference is which action the answers go to
 * and whether there is anything to delete. The page hands it a draft with the
 * fields already filled in, so the reading of a stored event into a form
 * happens on the server, where the account's zone is known.
 *
 * A client component for one reason -- the all-day switch has to hide the time
 * fields as you tick it -- and for nothing else. Opening and closing it are
 * links, like the rest of this page, so the view and the day you are looking at
 * stay in the URL and the back button still works.
 *
 * The times are two fields rather than one datetime-local, the same choice
 * lib/todo/tasks/write.ts made for a due date: a whole day and an instant are
 * different things and one control cannot say both.
 */
export interface EventDraft {
  /** The event being changed, or null when this is a new one. */
  id: string | null;
  title: string;
  body: string;
  location: string;
  allDay: boolean;
  startDay: string;
  endDay: string;
  startTime: string;
  endTime: string;
}

export function EventForm({
  draft,
  view,
  anchor,
}: {
  draft: EventDraft;
  /** Where to go back to, whether you save, delete or cancel. */
  view: string;
  anchor: string;
}) {
  const [allDay, setAllDay] = useState(draft.allDay);
  const [state, action, pending] = useActionState<EventFormState, FormData>(
    draft.id ? editEvent : addEvent,
    {},
  );

  const back = { pathname: '/todo/calendar', query: { view, date: anchor } };

  return (
    <Card className="mt-4">
      <form action={action} className="space-y-3">
        {draft.id && <input type="hidden" name="id" value={draft.id} />}
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="date" value={anchor} />

        <Field id="event-title" label="What is it?">
          <Input
            id="event-title"
            name="title"
            required
            autoFocus
            placeholder="Dentist"
            defaultValue={draft.title}
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="event-start-day" label="Day">
            <Input
              id="event-start-day"
              name="startDay"
              type="date"
              defaultValue={draft.startDay}
              required
            />
          </Field>
          <Field
            id="event-end-day"
            label="Ends (optional)"
            hint="Leave empty for something that starts and finishes on one day."
          >
            <Input id="event-end-day" name="endDay" type="date" defaultValue={draft.endDay} />
          </Field>
        </div>

        <label
          htmlFor="event-all-day"
          className="flex w-fit cursor-pointer items-center gap-2 text-ui text-ink"
        >
          <input
            id="event-all-day"
            type="checkbox"
            name="allDay"
            checked={allDay}
            onChange={(event) => setAllDay(event.target.checked)}
            className="size-4 accent-accent"
          />
          All day
        </label>

        {/* Hidden rather than unmounted: a time typed, then switched to all
            day, then switched back is still there. The write layer ignores
            both fields when all day is ticked. */}
        <div className={cn('grid gap-3 sm:grid-cols-2', allDay && 'hidden')}>
          <Field id="event-start-time" label="From">
            <Input
              id="event-start-time"
              name="startTime"
              type="time"
              defaultValue={draft.startTime}
            />
          </Field>
          <Field id="event-end-time" label="To">
            <Input id="event-end-time" name="endTime" type="time" defaultValue={draft.endTime} />
          </Field>
        </div>

        <Field id="event-location" label="Where (optional)">
          <Input
            id="event-location"
            name="location"
            placeholder="The surgery on Mill Road"
            defaultValue={draft.location}
          />
        </Field>

        <Field id="event-body" label="Notes (optional)">
          <Textarea id="event-body" name="body" rows={2} defaultValue={draft.body} />
        </Field>

        <FieldError>{state.error}</FieldError>

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            Save
          </Button>
          <Link href={back} className={buttonVariants({ variant: 'ghost' })}>
            Cancel
          </Link>
        </div>
      </form>

      {draft.id && <DeleteEvent id={draft.id} view={view} anchor={anchor} />}
    </Card>
  );
}

/**
 * Its own form, below the one that edits.
 *
 * A form cannot hold another, and a button that submits somewhere else has no
 * way of showing what came back when it fails. Below rather than beside Save
 * for the ordinary reason: the destructive one should not be the button your
 * hand is already near.
 */
function DeleteEvent({ id, view, anchor }: { id: string; view: string; anchor: string }) {
  const [state, action, pending] = useActionState<EventFormState, FormData>(removeEvent, {});

  return (
    <form action={action} className="mt-4 border-t border-border pt-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="view" value={view} />
      <input type="hidden" name="date" value={anchor} />

      <Button type="submit" variant="danger" size="sm" disabled={pending}>
        Delete
      </Button>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}
