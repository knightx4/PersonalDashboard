import 'server-only';

import { createTodoClient } from '@/lib/todo/auth/server';

/**
 * The overlay: the only thing this module stores about an obligation it does
 * not own.
 *
 * `until` null means "not this one, for good"; a date means "later". The same
 * distinction job_search.waiting_dismissals already draws, generalised.
 *
 * Not every source uses this. A job reminder is deferred by moving its own due
 * date, on its own row, so both /jobs/today and /todo agree without an overlay
 * at all -- see lib/todo/agenda/sources/. This is for the sources that have
 * nowhere else to put it.
 */

export type Dismissals = Map<string, { until: string | null }>;

/** Which foreign_source enum value a source's dismissals are stored under. */
export type DismissalSource = 'return_deadline' | 'goal_step';

export async function loadDismissals(userId: string): Promise<Dismissals> {
  const supabase = await createTodoClient();

  const { data } = await supabase
    .from('dismissals')
    .select('source_key, dismissed_until')
    .eq('user_id', userId);

  const map: Dismissals = new Map();
  for (const row of data ?? []) {
    map.set(row.source_key as string, { until: (row.dismissed_until as string | null) ?? null });
  }
  return map;
}

export async function dismiss(
  userId: string,
  source: DismissalSource,
  sourceKey: string,
  until: Date | null,
): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();

  const { error } = await supabase.from('dismissals').upsert(
    {
      user_id: userId,
      source,
      source_key: sourceKey,
      dismissed_until: until?.toISOString() ?? null,
    },
    { onConflict: 'user_id,source,source_key' },
  );

  return { error: error?.message ?? null };
}

/** Undo a dismissal entirely, rather than shortening it. */
export async function undismiss(
  userId: string,
  source: DismissalSource,
  sourceKey: string,
): Promise<{ error: string | null }> {
  const supabase = await createTodoClient();

  const { error } = await supabase
    .from('dismissals')
    .delete()
    .eq('user_id', userId)
    .eq('source', source)
    .eq('source_key', sourceKey);

  return { error: error?.message ?? null };
}
