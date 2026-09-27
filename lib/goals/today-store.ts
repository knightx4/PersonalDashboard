import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { flagsWaiting } from '@/lib/goals/flags';
import { goalProposals } from '@/lib/goals/goal-proposals';
import type { GoalReview } from '@/lib/goals/reviews';
import { loadGoalActivity, loadLatestReviews } from '@/lib/goals/reviews-store';
import { loadGoalFlags } from '@/lib/goals/flags-store';
import { homeRhythms, liveRhythms } from '@/lib/goals/rhythms';
import { syncRhythms } from '@/lib/goals/rhythms-store';
import type { StepNode } from '@/lib/goals/steps';
import { loadLiveTree } from '@/lib/goals/steps-store';
import { didYouGoSuggestions, homeSuggestions } from '@/lib/goals/suggestions';
import { loadGoingSuggestions, loadRecentSuggestions } from '@/lib/goals/suggestions-store';
import { todayList, type TodayInput, type TodayItem } from '@/lib/goals/today';
import type { Goal } from '@/lib/goals/tree';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

type LiveTree = { goals: { goal: Goal; areaName: string }[]; byGoal: Map<string, StepNode[]> };

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
  const tree = await loadLiveTree(client, { today });
  return todayList(await loadTodayInput(client, supabase, { userId, today, tree }));
}

/**
 * What Today ranks, read around a live tree the caller already has, so the
 * home reads the tree and syncs the rhythms once for Today and the goal lines
 * both (lib/goals/home-store.ts). The newest review of each goal comes back
 * beside it, for the goal lines. A failed read of the reviews or of what was
 * last done leaves the proposals to close or park a goal out (plan #1084).
 */
export async function loadTodayInput(
  client: GoalsSupabaseClient,
  supabase: Db,
  {
    userId,
    today,
    tree,
    now = Date.now(),
  }: { userId: string; today: string; tree: LiveTree; now?: number },
): Promise<TodayInput & { reviews: Map<string, GoalReview> }> {
  const { goals, byGoal } = tree;
  const live = liveRhythms(
    goals.map((g) => g.goal),
    byGoal,
  );
  const [flags, recent, going, records, reviews, activity] = await Promise.all([
    loadGoalFlags(supabase, { userId }).catch(() => []),
    loadRecentSuggestions(client).catch(() => []),
    loadGoingSuggestions(client).catch(() => []),
    syncRhythms(client, userId, live, today),
    loadLatestReviews(client, { now }).catch(() => new Map<string, GoalReview>()),
    loadGoalActivity(client, userId).catch(() => null),
  ]);
  const titles = new Map(goals.map(({ goal }) => [goal.id, goal.title]));
  return {
    goals,
    byGoal,
    today,
    rhythms: homeRhythms(live, records, today),
    flags: flagsWaiting(flags, titles),
    suggestions: homeSuggestions(recent, today),
    didYouGo: didYouGoSuggestions(going, today),
    proposals: activity
      ? goalProposals({ goals: goals.map((g) => g.goal), reviews, activity, now })
      : [],
    reviews,
  };
}
