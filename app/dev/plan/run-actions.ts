'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/auth/server';
import { requireOwner } from '@/lib/dev/owner';
import { acknowledgeStaleRun } from '@/lib/core/run-ack';

/**
 * Acknowledge a plan run that went silent, which ends it (plan #1825). Apart
 * from actions.ts, which is far too large to open for one small action.
 */
const Input = z.string().uuid();

// latency: pending
export async function acknowledgePlanRun(runId: string): Promise<{ error?: string }> {
  const supabase = await createClient();
  await requireOwner({ supabase });
  const parsed = Input.safeParse(runId);
  if (!parsed.success) return { error: 'Could not tell which run that was.' };

  const { ended, error } = await acknowledgeStaleRun(supabase, 'plan_runs', parsed.data);
  if (error) return { error: 'The run could not be ended. Try again.' };
  revalidatePath('/dev/plan', 'layout');
  if (!ended) return { error: 'That run is no longer silent. Reload to see where it stands.' };
  return {};
}
