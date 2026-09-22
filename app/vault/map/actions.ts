'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';

/**
 * Starting, stopping and resuming the sweep (plan #757).
 *
 * Each action only changes the sweep's row. The reading is done by the cron
 * call every five minutes (app/api/cron/map-sweep), which works any sweep
 * marked running, so these return at once and the page says when the sweep
 * will pick up. Writes go through the session client and RLS.
 */

// latency: pending
export async function startSweep(): Promise<void> {
  const user = await requireUser();
  const supabase = await createVaultClient();

  // One unfinished sweep per person, enforced by map_sweeps_one_open_idx. A
  // second press while one is open resumes that one instead.
  const { data: open } = await supabase
    .from('map_sweeps')
    .select('id')
    .neq('status', 'done')
    .maybeSingle();

  if (open) {
    await supabase
      .from('map_sweeps')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', (open as { id: string }).id);
  } else {
    const { error } = await supabase.from('map_sweeps').insert({ user_id: user.id });
    if (error) throw new Error(`Starting the sweep failed: ${error.message}`);
  }
  revalidatePath('/vault/map');
}

// latency: pending
export async function stopSweep(): Promise<void> {
  await requireUser();
  const supabase = await createVaultClient();
  await supabase
    .from('map_sweeps')
    .update({ status: 'stopped', updated_at: new Date().toISOString() })
    .eq('status', 'running');
  revalidatePath('/vault/map');
}
