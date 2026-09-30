'use server';

import { getUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { isDay, isPickKey } from '@/lib/day-brief/opens';

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
