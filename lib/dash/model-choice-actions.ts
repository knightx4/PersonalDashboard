'use server';

import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import type { DashChoiceId } from '@/lib/core/models';
import { dashModelFor, saveDashModel } from '@/lib/dash/model-choice';

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

/**
 * The model Dash answers this account with, read again by the chip in Dash's
 * box after Dash itself changed it in an answer (plan #2458.3). The shell
 * reads it for the first draw.
 */
// latency: instant -- one row by primary key, read after the answer has landed
export async function getDashModel(): Promise<DashChoiceId> {
  const user = await requireUser();
  const core = await createCoreClient();
  return dashModelFor(core, user.id);
}
