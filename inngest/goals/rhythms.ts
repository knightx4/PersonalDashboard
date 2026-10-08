import 'server-only';

import { z } from 'zod';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { liveRhythms } from '@/lib/goals/rhythms';
import { syncRhythms } from '@/lib/goals/rhythms-store';
import { accountToday, loadLiveTree } from '@/lib/goals/steps-store';
import { createGoalsServiceSupabase } from '@/inngest/goals/supabase-admin';

/**
 * Rhythm periods brought up to today for the owner, a stage of the daily
 * cron (docs/GOALS-SPEC.md, "Rhythms").
 *
 * The pages sync rhythms whenever they read them, so until now a period
 * ended on a day nobody opened the app stayed open, and a rhythm that counts
 * itself showed yesterday's count until a page was opened. This runs the
 * same sync each morning: ended periods close as kept or missed, the current
 * one opens, and counts read from Jobs or the calendar are written. Running
 * it again the same day writes nothing new, since the sync writes only the
 * difference.
 *
 * The owner only, with the service-role client, as the morning goals run is.
 */

export type GoalsRhythmsResult = { skipped: string } | { rhythms: number };

const ownerSchema = z.object({ userId: z.string().uuid() });

export async function runGoalsRhythms(
  deps?: Partial<{ client: GoalsSupabaseClient; now: number }>,
): Promise<GoalsRhythmsResult> {
  const client = deps?.client ?? createGoalsServiceSupabase();
  const now = deps?.now ?? Date.now();

  const owner = await client.schema('public').rpc('app_owner');
  const parsed = ownerSchema.safeParse(owner.data);
  if (owner.error || !parsed.success) throw new Error('Could not resolve the owner to sync rhythms for.');
  const userId = parsed.data.userId;

  const today = await accountToday(client, userId, now);
  const { goals, byGoal } = await loadLiveTree(client, { userId, today });
  const live = liveRhythms(
    goals.map((g) => g.goal),
    byGoal,
  );
  if (live.length === 0) return { skipped: 'no live rhythm' };
  await syncRhythms(client, userId, live, today);
  return { rhythms: live.length };
}
