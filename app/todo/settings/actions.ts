'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { isSourceId, type SourceId } from '@/lib/todo/agenda/sources';
import { saveAgendaSettings } from '@/lib/todo/agenda/settings';

export interface AgendaSettingsState {
  error?: string;
  message?: string;
}

const horizonSchema = z.coerce
  .number()
  .int()
  .min(1, 'A horizon of less than a day is not a horizon.')
  .max(90, 'Ninety days is the most the agenda will look ahead.');

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
