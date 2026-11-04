'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import type { HoursEntry } from '@/lib/goals/hours';
import { loadHoursDayEntries } from '@/lib/goals/hours-store';

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * The hours logged on one day, for the drawer a day cell opens on the Hours
 * page (plan #2907.2). Read each time the drawer opens, so a change made
 * elsewhere since the page loaded shows.
 */
// latency: pending
export async function loadHoursDay(
  day: string,
): Promise<{ entries: HoursEntry[]; error: string | null }> {
  const parsed = Day.safeParse(day);
  if (!parsed.success) return { entries: [], error: 'That day could not be read.' };
  await requireUser();
  try {
    const client = await createGoalsClient();
    return { entries: await loadHoursDayEntries(client, parsed.data), error: null };
  } catch {
    return { entries: [], error: 'The hours for this day could not be read.' };
  }
}
