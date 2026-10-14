import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';

/**
 * Goals settings (plan #1937.10), kept in `goals.settings`, one row per
 * account: whether the morning run and the weekly run start. No row means
 * both are on, which is how the runs behaved before /goals/settings existed.
 *
 * Every read and write names the account, so these work through the service
 * client from the cron and through the person's own session from the page.
 */
export type GoalSettings = {
  /** The morning run (plan #933): statements, closing steps, a status per goal. */
  morningRun: boolean;
  /** The weekly run (plan #934): suggestions of events, reading and leads. */
  weeklyRun: boolean;
};

export const GOAL_SETTINGS_DEFAULT: GoalSettings = { morningRun: true, weeklyRun: true };

/** The columns each setting is kept in. */
const COLUMNS = { morningRun: 'morning_run', weeklyRun: 'weekly_run' } as const;

export type GoalSettingKey = keyof typeof COLUMNS;

export function isGoalSettingKey(value: unknown): value is GoalSettingKey {
  return typeof value === 'string' && Object.hasOwn(COLUMNS, value);
}

export async function loadGoalSettings(
  client: GoalsSupabaseClient,
  userId: string,
): Promise<GoalSettings> {
  const { data, error } = await client
    .from('settings')
    .select('morning_run, weekly_run')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error(`Reading your Goals settings failed: ${error.message}`);
  const row = data as { morning_run: boolean; weekly_run: boolean } | null;
  return row ? { morningRun: row.morning_run, weeklyRun: row.weekly_run } : GOAL_SETTINGS_DEFAULT;
}

/**
 * Whether one run is switched on, for the cron. A read that fails reads as
 * on: the runs started every day before this setting existed, and a run that
 * starts once too often costs less than one that silently stops.
 */
export async function goalRunOn(
  client: GoalsSupabaseClient,
  userId: string,
  key: GoalSettingKey,
): Promise<boolean> {
  try {
    return (await loadGoalSettings(client, userId))[key];
  } catch {
    return true;
  }
}

export async function saveGoalSetting(
  client: GoalsSupabaseClient,
  userId: string,
  key: GoalSettingKey,
  on: boolean,
): Promise<void> {
  const { error } = await client
    .from('settings')
    .upsert(
      { user_id: userId, [COLUMNS[key]]: on, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  if (error) throw new Error(`Saving that failed: ${error.message}`);
}
