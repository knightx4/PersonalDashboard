import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { dailyView } from '@/lib/goals/daily';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { HomeGoal } from '@/lib/goals/home';
import { isCurrent } from '@/lib/goals/reviews';
import { loadLatestReviews } from '@/lib/goals/reviews-store';
import { goalProgress } from '@/lib/goals/status';
import { loadLiveTree } from '@/lib/goals/steps-store';
import { TODAY_CAP, todayRanked, type TodayItem } from '@/lib/goals/today';
import { loadTodayInput } from '@/lib/goals/today-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

export type Home = {
  /** Today: the first TODAY_CAP of everything on you, ranked. */
  today: TodayItem[];
  /** The rest of what is on you, in the same order, folded under Today. */
  later: TodayItem[];
  /** Every open goal in page order, as its line on the home. */
  goals: HomeGoal[];
};

/**
 * What the Goals home reads (plan #1077), apart from what Dash did, which is
 * loadDoneSince: the live tree once, which Today and the goal lines share,
 * and each goal's newest status. `supabase` is the ordinary signed-in client,
 * for the flags in public.raised_items.
 */
export async function loadHome(
  client: GoalsSupabaseClient,
  supabase: Db,
  { userId, today, now }: { userId: string; today: string; now: number },
): Promise<Home> {
  const tree = await loadLiveTree(client, { today });
  const [input, reviews] = await Promise.all([
    loadTodayInput(client, supabase, { userId, today, tree }),
    // A failed read leaves the statuses off the lines rather than the page.
    loadLatestReviews(client).catch(() => new Map()),
  ]);
  const ranked = todayRanked(input);
  const goals = dailyView(tree.goals, tree.byGoal, today).goals.map((daily): HomeGoal => {
    const review = reviews.get(daily.goal.id) ?? null;
    return {
      goal: daily.goal,
      areaName: daily.areaName,
      progress: goalProgress(tree.byGoal.get(daily.goal.id) ?? []),
      review,
      current: review ? isCurrent(review, now) : false,
      next: daily.next[0] ?? null,
      hasSteps: daily.hasSteps,
    };
  });
  return { today: ranked.slice(0, TODAY_CAP), later: ranked.slice(TODAY_CAP), goals };
}
