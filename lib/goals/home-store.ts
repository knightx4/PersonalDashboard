import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { dailyView } from '@/lib/goals/daily';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  dashOffers,
  goalHolders,
  isGoing,
  preparableSteps,
  type DashOffer,
} from '@/lib/goals/hand-off';
import type { HomeGoal } from '@/lib/goals/home';
import { dashLane, laterLane, type DashLaneItem, type LaterLaneItem } from '@/lib/goals/lanes';
import { isCurrent } from '@/lib/goals/reviews';
import type { RunListing } from '@/lib/goals/runs';
import { loadRunsStartedSince } from '@/lib/goals/runs-store';
import { goalProgress } from '@/lib/goals/status';
import { loadLiveTree } from '@/lib/goals/steps-store';
import { todayRanked, withPrepared, type TodayItem } from '@/lib/goals/today';
import { loadTodayInput } from '@/lib/goals/today-store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, 'public'>;

export type Home = {
  /**
   * Everything on you, ranked, each step with what Dash prepared for it. The
   * home splits it into Do next and the rest (homeLists in lib/goals/home.ts).
   */
  onYou: TodayItem[];
  /** Every open goal in page order, as its line on the home. */
  goals: HomeGoal[];
  /** The runs going now, newest first. */
  working: RunListing[];
  /** What Put Dash to work offers (lib/goals/hand-off.ts). */
  offers: DashOffer[];
  /** The steps on you that Dash could prepare. */
  preparable: string[];
  /** What Dash has (lib/goals/lanes.ts). */
  dash: DashLaneItem[];
  /** Steps whose start date is still ahead. */
  laterOn: LaterLaneItem[];
};

/** How far back the home reads runs: past QUIET_DAYS, so a quiet goal is told from one never worked. */
const RUNS_READ_DAYS = 30;

/**
 * What the Goals home reads (plan #1077), apart from what Dash did, which is
 * loadDoneSince: the live tree once, which what is on you, the drafts Dash
 * prepared and the goal lines all share, each goal's newest status, and the
 * runs. `supabase` is the ordinary signed-in client, for the flags in
 * public.raised_items.
 */
export async function loadHome(
  client: GoalsSupabaseClient,
  supabase: Db,
  { userId, today, now }: { userId: string; today: string; now: number },
): Promise<Home> {
  const tree = await loadLiveTree(client, { today });
  const since = new Date(now - RUNS_READ_DAYS * 86_400_000).toISOString();
  const [input, runs] = await Promise.all([
    // Its reviews double as the goal lines' statuses; a failed read of them
    // leaves the statuses off the lines rather than the page.
    loadTodayInput(client, supabase, { userId, today, tree, now }),
    // A failed read leaves the board without Dash's part and offers nothing.
    loadRunsStartedSince(client, since).catch((): RunListing[] => []),
  ]);
  const { reviews } = input;
  // The drafts come from the tree already read: a prep step's result, or the step's own.
  const ranked = withPrepared(todayRanked(input), tree.byGoal);
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
  const holders = goalHolders({ goals, byGoal: tree.byGoal, onYou: ranked, runs, now });
  return {
    onYou: ranked,
    goals,
    working: runs.filter((run) => isGoing(run, now)),
    offers: dashOffers({ goals, byGoal: tree.byGoal, onYou: ranked, holders, runs, now }),
    preparable: preparableSteps({ byGoal: tree.byGoal, onYou: ranked, runs, now }),
    dash: dashLane({ goals: tree.goals, byGoal: tree.byGoal, runs, now }),
    laterOn: laterLane({ goals: tree.goals, byGoal: tree.byGoal, today }),
  };
}
