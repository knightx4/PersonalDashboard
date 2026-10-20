'use server';

import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { isDashChoice } from '@/lib/core/models';

export type SetDashModelResult = { ok: true } | { ok: false; error: string };

/**
 * Save the model the person chose for Dash (plan #2458.1). Refuses anything
 * but the three ids in lib/core/models.ts before it reaches the database,
 * which refuses it too (account_settings_dash_model_ck). Null clears the
 * choice, back to the default.
 */
// latency: instant -- the picker shows the pick itself and does not wait for the write
export async function setDashModel(model: string | null): Promise<SetDashModelResult> {
  if (model !== null && !isDashChoice(model)) {
    return { ok: false, error: 'Dash can answer with Haiku, Sonnet or Opus.' };
  }
  const user = await requireUser();
  const core = await createCoreClient();
  const { error } = await core
    .from('account_settings')
    .upsert({ user_id: user.id, dash_model: model }, { onConflict: 'user_id' });
  if (error) return { ok: false, error: 'Could not save that choice. Try again.' };
  return { ok: true };
}
