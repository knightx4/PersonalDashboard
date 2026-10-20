'use server';

import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { saveDashModel } from './model-choice';

export type SetDashModelResult = { ok: true } | { ok: false; error: string };

/**
 * Save the model the person chose for Dash (plan #2458.1). The write is
 * saveDashModel in lib/dash/model-choice.ts, which Dash's set_dash_model tool
 * calls too. Null clears the choice, back to the default.
 */
// latency: instant -- the picker shows the pick itself and does not wait for the write
export async function setDashModel(model: string | null): Promise<SetDashModelResult> {
  const user = await requireUser();
  const core = await createCoreClient();
  const saved = await saveDashModel(core, user.id, model);
  return saved.ok ? { ok: true } : saved;
}
