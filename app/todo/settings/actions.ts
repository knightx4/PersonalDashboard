'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isSourceId, type SourceId } from '@/lib/todo/agenda/sources';
import { saveAgendaSettings } from '@/lib/todo/agenda/settings';
import { createFeed, deleteFeed, feedInput } from '@/lib/todo/feeds/write';
import { refreshFeed } from '@/lib/todo/feeds/refresh';

export interface AgendaSettingsState {
  error?: string;
  message?: string;
}

/**
 * Every page that draws the calendar or the agenda reads these appointments,
 * so a subscription changing invalidates all of them rather than guessing
 * which one is on screen.
 */
function revalidateCalendar(): void {
  revalidatePath('/todo');
  revalidatePath('/todo/calendar');
  revalidatePath('/todo/settings');
  revalidatePath('/home');
}

const horizonSchema = z.coerce
  .number()
  .int()
  .min(1, 'A horizon of less than a day is not a horizon.')
  .max(90, 'Ninety days is the most the agenda will look ahead.');

// latency: pending
export async function updateAgendaSettings(
  _prev: AgendaSettingsState,
  formData: FormData,
): Promise<AgendaSettingsState> {
  const horizon = horizonSchema.safeParse(formData.get('horizonDays'));
  if (!horizon.success) return { error: horizon.error.issues[0].message };

  // Only names this build knows. A stale value in a form is a stale value, not
  // an instruction, and unknown source names must not reach the column.
  const enabledSources = [...formData.keys()]
    .filter((key) => key.startsWith('source:') && formData.get(key) === 'on')
    .map((key) => key.slice('source:'.length))
    .filter((id): id is SourceId => isSourceId(id));

  const user = await requireUser();
  const { error } = await saveAgendaSettings(user.id, {
    enabledSources,
    horizonDays: horizon.data,
  });

  if (error) return { error };

  revalidatePath('/todo');
  revalidatePath('/todo/settings');
  revalidatePath('/home');
  return { message: 'Saved.' };
}

/**
 * Subscribe to a calendar you keep somewhere else.
 *
 * It is read straight away rather than waiting for the next refresh, because
 * the answer to "did that address work" is the whole reason anybody watches
 * this form. A read that fails still leaves the subscription: the address may
 * be right and the calendar temporarily down, and the row carries the reason.
 */
// latency: pending
export async function addFeed(
  _prev: AgendaSettingsState,
  formData: FormData,
): Promise<AgendaSettingsState> {
  const parsed = feedInput.safeParse({
    name: formData.get('name') ?? '',
    address: formData.get('address') ?? '',
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const user = await requireUser();
  const { id, error } = await createFeed(user.id, parsed.data);
  if (error || !id) return { error: error ?? 'That calendar could not be added.' };

  const { timezone } = await loadAccountSettings(user.id);
  const read = await refreshFeed(user.id, id, new Date(), timezone);

  revalidateCalendar();
  return read.error ? { error: read.error } : { message: 'Added.' };
}

// latency: pending
export async function refreshFeedNow(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();
  const { timezone } = await loadAccountSettings(user.id);

  const { error } = await refreshFeed(user.id, id, new Date(), timezone);

  revalidateCalendar();
  return { error };
}

// latency: pending
export async function removeFeed(id: string): Promise<{ error: string | null }> {
  const user = await requireUser();

  const { error } = await deleteFeed(user.id, id);
  if (error) return { error };

  revalidateCalendar();
  return { error: null };
}
