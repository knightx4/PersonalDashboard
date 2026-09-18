'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createEvent, deleteEvent, eventInput, updateEvent } from '@/lib/todo/events/write';
import { setFeedShown } from '@/lib/todo/feeds/write';
import { isCalendarView, isDay } from '@/lib/todo/calendar/range';

/**
 * Writing an event from the calendar.
 *
 * The page holds no client state -- the view and the day are in the URL -- so
 * a successful write ends by sending you back to the view you were looking at
 * rather than by closing a form nobody is holding open. An error comes back as
 * state and the form says it, because a message on the page you are typing on
 * is the only place it is any use.
 */

export interface EventFormState {
  error?: string;
}

function parse(formData: FormData) {
  return eventInput.safeParse({
    title: formData.get('title') ?? '',
    body: formData.get('body') ?? '',
    location: formData.get('location') ?? '',
    allDay: formData.get('allDay') === 'on',
    startDay: formData.get('startDay') ?? '',
    endDay: formData.get('endDay') ?? '',
    startTime: formData.get('startTime') ?? '',
    endTime: formData.get('endTime') ?? '',
  });
}

/** Where to go back to: the view and day the form was opened from. */
function backTo(formData: FormData): string {
  const view = String(formData.get('view') ?? '');
  const date = String(formData.get('date') ?? '');

  const query = new URLSearchParams();
  if (isCalendarView(view)) query.set('view', view);
  if (isDay(date)) query.set('date', date);

  const search = query.toString();
  return search ? `/todo/calendar?${search}` : '/todo/calendar';
}

// latency: pending
export async function addEvent(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const user = await requireUser();
  const { timezone } = await loadAccountSettings(user.id);

  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { error } = await createEvent(user.id, parsed.data, timezone);
  if (error) return { error };

  revalidatePath('/todo/calendar');
  redirect(backTo(formData));
}

// latency: pending
export async function editEvent(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const user = await requireUser();
  const { timezone } = await loadAccountSettings(user.id);

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Which event is this?' };

  const parsed = parse(formData);
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { error } = await updateEvent(user.id, id, parsed.data, timezone);
  if (error) return { error };

  revalidatePath('/todo/calendar');
  redirect(backTo(formData));
}

/**
 * Delete, from its own form under the one that edits.
 *
 * Its own form rather than a second button inside the first, because a button
 * that submits somewhere else has no way of showing what came back when it
 * fails. The write is scoped to the account, so an id belonging to somebody
 * else deletes nothing rather than being refused -- there is nothing to tell
 * you about a row you cannot see.
 */
// latency: pending
export async function removeEvent(
  _prev: EventFormState,
  formData: FormData,
): Promise<EventFormState> {
  const user = await requireUser();

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Which event is this?' };

  const { error } = await deleteEvent(user.id, id);
  if (error) return { error };

  revalidatePath('/todo/calendar');
  redirect(backTo(formData));
}

export interface CalendarPickerState {
  error?: string;
}

/**
 * Draw a subscribed calendar, or stop drawing it.
 *
 * No redirect, unlike the writes above: the panel this is submitted from stays
 * open and the page behind it is re-rendered, so switching three calendars off
 * is three clicks rather than three round trips through the month. The agenda
 * is revalidated too -- a calendar switched off here is off there as well, and
 * a stale agenda would put it back.
 *
 * The write is scoped to the account, so an id belonging to somebody else
 * changes nothing rather than being refused.
 */
// latency: pending
export async function toggleCalendar(
  _prev: CalendarPickerState,
  formData: FormData,
): Promise<CalendarPickerState> {
  const user = await requireUser();

  const id = String(formData.get('id') ?? '');
  if (!id) return { error: 'Which calendar is this?' };

  const { error } = await setFeedShown(user.id, id, formData.get('shown') === 'on');
  if (error) return { error };

  revalidatePath('/todo/calendar');
  revalidatePath('/todo');
  return {};
}
