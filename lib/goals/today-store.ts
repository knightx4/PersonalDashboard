import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { flagsWaiting } from '@/lib/goals/flags';
import { loadGoalFlags } from '@/lib/goals/flags-store';
import { homeRhythms, liveRhythms } from '@/lib/goals/rhythms';
import { syncRhythms } from '@/lib/goals/rhythms-store';
import { loadLiveTree } from '@/lib/goals/steps-store';
import { didYouGoSuggestions, homeSuggestions } from '@/lib/goals/suggestions';
import { loadGoingSuggestions, loadRecentSuggestions } from '@/lib/goals/suggestions-store';
import { todayList, type TodayItem } from '@/lib/goals/today';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

/**
 * The Today list for the Goals home (plan #1075): every read it ranks, then
 * todayList in lib/goals/today.ts. `supabase` is the ordinary signed-in client,
 * for the flags in public.raised_items; `client` is the goals one. A failed
 * read of flags or suggestions leaves those out rather than the list.
 */
export async function loadToday(
  client: GoalsSupabaseClient,
  supabase: Db,
  { userId, today }: { userId: string; today: string },
): Promise<TodayItem[]> {
  const [{ goals, byGoal }, flags, recent, going] = await Promise.all([
    loadLiveTree(client, { today }),
    loadGoalFlags(supabase, { userId }).catch(() => []),
    loadRecentSuggestions(client).catch(() => []),
    loadGoingSuggestions(client).catch(() => []),
  ]);
  const live = liveRhythms(
    goals.map((g) => g.goal),
    byGoal,
  );
  const records = await syncRhythms(client, userId, live, today);
  const titles = new Map(goals.map(({ goal }) => [goal.id, goal.title]));
  return todayList({
    goals,
    byGoal,
    today,
    rhythms: homeRhythms(live, records, today),
    flags: flagsWaiting(flags, titles),
    suggestions: homeSuggestions(recent, today),
    didYouGo: didYouGoSuggestions(going, today),
  });
}
