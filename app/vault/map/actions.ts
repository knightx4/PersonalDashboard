'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { undoMapMerge } from '@/lib/vault/map/merge-apply';
import { undoRefusal } from '@/lib/vault/map/merge-log';

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

/** What an undo or a rename on the merge log says back: null when it worked. */
export type MergeLogActionResult = { error: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Undo one merge from the log (plan #821): obsidian.undo_map_merge puts the
 * absorbed row back with everything the merge moved, and stamps the merge
 * undone. The candidate searches and the apply run both leave an undone pair
 * alone (0013), so nothing merges it again. The function checks the owner.
 */
// latency: pending
export async function undoMerge(mergeId: string): Promise<MergeLogActionResult> {
  await requireUser();
  if (!UUID.test(mergeId)) return { error: 'That merge is not in the log.' };
  const supabase = await createVaultClient();
  const outcome = await undoMapMerge(supabase, mergeId);
  if (!outcome.ok) return { error: undoRefusal(outcome) };
  revalidatePath('/vault/map');
  return { error: null };
}

/**
 * Rename the theme a merge kept (plan #821). A plain update through RLS; the
 * embedding trigger clears the theme's vector so the next embed run reads the
 * new name. Names are unique per person, ignoring case.
 */
// latency: pending
export async function renameTheme(themeId: string, name: string): Promise<MergeLogActionResult> {
  await requireUser();
  const trimmed = name.trim();
  if (!UUID.test(themeId)) return { error: 'That theme is not in the map.' };
  if (!trimmed) return { error: 'A theme needs a name.' };
  if (trimmed.length > 200) return { error: 'Keep the name under 200 characters.' };

  const supabase = await createVaultClient();
  const { data, error } = await supabase
    .from('themes')
    .update({ name: trimmed })
    .eq('id', themeId)
    .select('id');
  if (error) {
    if (error.code === '23505') return { error: 'Another theme already has that name.' };
    return { error: `The rename failed: ${error.message}` };
  }
  if (!data || data.length === 0) return { error: 'That theme is no longer in the map.' };
  revalidatePath('/vault/map');
  revalidatePath(`/vault/map/${themeId}`);
  return { error: null };
}
