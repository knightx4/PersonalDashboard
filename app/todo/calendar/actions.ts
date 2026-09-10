'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { createEvent, eventInput } from '@/lib/todo/events/write';
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
