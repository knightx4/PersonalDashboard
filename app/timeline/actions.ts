'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient, requireUser } from '@/lib/auth/server';

/**
 * Mark one of the week's observations not useful (plan #1120). It is hidden
 * from the home page and the timeline for good, and the next weekly run is
 * given its sentence as something to leave alone (lib/timeline/
 * observations-run.ts). RLS lets the person change only the verdict and when
 * it was given, and only on their own rows.
 */
// latency: optimistic -- the observation leaves the list at once, and a refused write puts it back with a toast
export async function markObservationNotUseful(id: string): Promise<{ error: string | null }> {
  if (!z.string().uuid().safeParse(id).success) return { error: 'That observation could not be found.' };

  await requireUser();
  const client = await createClient();
  const { data, error } = await client
    .schema('core')
    .from('observations')
    .update({ verdict: 'not_useful', verdict_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (error) return { error: 'That did not save. Try again.' };
  if (!data || data.length === 0) return { error: 'That observation is no longer there.' };

  revalidatePath('/');
  revalidatePath('/timeline');
  return { error: null };
}
