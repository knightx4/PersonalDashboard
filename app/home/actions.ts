'use server';

import { revalidatePath } from 'next/cache';
import { getUser, requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { isDay, isPickKey } from '@/lib/day-brief/opens';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Record that a pick on the morning brief was followed (plan #1242).
 *
 * Stamps opened_at on that pick inside the day's picks, the first time only,
 * through core.open_day_brief_pick, which runs as the caller and touches only
 * their own brief. The person has read access alone on core.day_briefs, which
 * is why this goes through the function rather than an update.
 *
 * The link navigates whether or not this lands, so it never throws: a failed
 * stamp costs one entry in a record nothing reads yet.
 */
// latency: instant -- fired as the link is followed; nothing waits for it
export async function openBriefPick(day: string, key: string): Promise<void> {
  if (!isDay(day) || !isPickKey(key)) return;
  const user = await getUser();
  if (!user) return;
  try {
    const core = await createCoreClient();
    const { error } = await core.rpc('open_day_brief_pick', { p_day: day, p_key: key });
    if (error) console.error('recording the opened pick failed', error.message);
  } catch (err) {
    console.error('recording the opened pick failed', err);
  }
}

export type StopWatchResult = { ok: true } | { ok: false; error: string };

/**
 * Stop a running watch from its row in the Watching section (plan #1296).
 *
 * Sets the status to 'stopped' as the person, which RLS keeps to their own
 * watches; the hourly run then leaves it alone, and the touched updated_at
 * puts it in Updates as "You stopped watching …" (lib/shell/watching.ts).
 * Only a running watch is stopped, so a watch that ended in the meantime
 * keeps its ending.
 */
// latency: pending
export async function stopWatch(formData: FormData): Promise<StopWatchResult> {
  const id = formData.get('id');
  if (typeof id !== 'string' || !UUID.test(id)) return { ok: false, error: 'Could not tell which watch that was.' };
  const user = await requireUser();
  const core = await createCoreClient();
  const { data, error } = await core
    .from('watches')
    .update({ status: 'stopped' })
    .eq('id', id)
    .eq('user_id', user.id)
    .eq('status', 'running')
    .select('id');
  if (error) return { ok: false, error: 'The watch could not be stopped. Try again.' };
  revalidatePath('/home');
  if ((data ?? []).length === 0) return { ok: false, error: 'That watch is not running any more.' };
  return { ok: true };
}
