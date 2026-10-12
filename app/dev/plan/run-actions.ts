'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';
import { ACKNOWLEDGED_STALE_ERROR } from '@/lib/core/run-activities';
import type { AcknowledgeRunState } from '@/components/runs/acknowledge-run';

/**
 * Acknowledge on a plan run that has gone quiet (plan #1826): it ends as
 * failed, saying it stopped writing and you saw it. Only a run still reading
 * stale is touched, so a run that woke up in the meantime keeps going. Kept
 * out of actions.ts, which every plan press already loads.
 */
// latency: pending
export async function acknowledgePlanRunAction(
  _prev: AcknowledgeRunState,
  form: FormData,
): Promise<AcknowledgeRunState> {
  const user = await requireUser();
  const runId = z.string().uuid().safeParse(form.get('runId'));
  if (!runId.success) return { error: 'Could not tell which run that was.' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('plan_runs')
    .update({ status: 'failed', error: ACKNOWLEDGED_STALE_ERROR })
    .eq('id', runId.data)
    .eq('user_id', user.id)
    .eq('status', 'stale')
    .select('id');
  if (error) return { error: 'That could not be saved. Try again.' };
  if (!data || data.length === 0) return { error: 'This run is not quiet any more. Reload to see where it stands.' };
  revalidatePath('/dev/plan', 'layout');
  return {};
}
