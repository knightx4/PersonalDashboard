'use server';

import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { isGoalSettingKey, saveGoalSetting, type GoalSettingKey } from '@/lib/goals/settings-store';

/**
 * Goals settings' one write (plan #1937.10): switch the morning or the weekly
 * run on or off. The page binds the key, so each switch saves its own.
 */
// latency: optimistic
export async function setGoalRun(key: GoalSettingKey, on: boolean): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!isGoalSettingKey(key) || typeof on !== 'boolean') return { error: 'That is not a setting here.' };
  try {
    await saveGoalSetting(await createGoalsClient(), user.id, key, on);
    return {};
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Could not keep that.' };
  }
}
