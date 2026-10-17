import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * Whether Learn draws from your goals alone (plan #2164.1), kept in
 * `learn.settings.goals_only`. While it is on, Now's deck draws no vault
 * theme or gap field (`targets.ts`) and deals none already picked, and
 * Practice Flow asks no survey question (`rate.ts`) and opens on Goals only.
 * Off by default, and with no row (plan #2302.1): Practice asks about every
 * prepared subject unless you narrow it.
 */
export async function loadGoalsOnly(learn: LearnSupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await learn
    .from('settings')
    .select('goals_only')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading your Learn settings failed: ${error.message}`);
  const on = (data as { goals_only: boolean } | null)?.goals_only;
  return typeof on === 'boolean' ? on : false;
}

/** The same, for a reader that would rather go on than fail: a failed read is off, the default. */
export function goalsOnlyOrDefault(learn: LearnSupabaseClient, userId: string): Promise<boolean> {
  return loadGoalsOnly(learn, userId).catch((error: unknown) => {
    console.error('[learn] goals-only setting', error instanceof Error ? error.message : error);
    return false;
  });
}

export async function saveGoalsOnly(learn: LearnSupabaseClient, userId: string, on: boolean): Promise<void> {
  const { error } = await learn
    .from('settings')
    .upsert({ user_id: userId, goals_only: on, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw new Error(`Saving that failed: ${error.message}`);
}
