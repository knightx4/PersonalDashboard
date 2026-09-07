import 'server-only';

import { createTodoClient } from '@/lib/todo/auth/server';
import { isSourceId, type SourceId } from '@/lib/todo/agenda/sources';

/**
 * This module's own settings: the horizon, and which sources may run.
 *
 * Both are meaningless with the module switched off, which is the test for
 * what belongs here rather than in core.account_settings.
 */

export interface AgendaSettings {
  enabledSources: SourceId[];
  horizonDays: number;
}

/**
 * No sources, seven days.
 *
 * Used both as the column defaults and when there is no row, which there
 * usually is not -- nothing creates one on sign-up, because the absence of a
 * row is a complete answer and one more trigger on the shared auth.users table
 * is one more chance for the accident tests/coexistence.test.ts exists to
 * catch.
 */
export const DEFAULT_AGENDA_SETTINGS: AgendaSettings = {
  enabledSources: [],
  horizonDays: 7,
};

export async function loadAgendaSettings(userId: string): Promise<AgendaSettings> {
  const supabase = await createTodoClient();

  const { data } = await supabase
    .from('agenda_settings')
    .select('enabled_sources, horizon_days')
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return DEFAULT_AGENDA_SETTINGS;

  const raw = Array.isArray(data.enabled_sources) ? (data.enabled_sources as unknown[]) : [];

  return {
    // Unknown names are dropped rather than trusted: a source removed from the
    // code leaves a harmless string in the column, and it must not become an
    // id nothing can look up.
    enabledSources: raw.filter((id): id is SourceId => typeof id === 'string' && isSourceId(id)),
    horizonDays: (data.horizon_days as number) ?? DEFAULT_AGENDA_SETTINGS.horizonDays,
  };
}

export async function saveAgendaSettings(
  userId: string,
  settings: AgendaSettings,
): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();

  // Upsert, because there may be no row yet -- see above.
  const { error } = await supabase.from('agenda_settings').upsert(
    {
      user_id: userId,
      enabled_sources: settings.enabledSources,
      horizon_days: settings.horizonDays,
    },
    { onConflict: 'user_id' },
  );

  return { error: error?.message ?? null };
}
