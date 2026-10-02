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
  type GoalHolders,
} from '@/lib/goals/hand-off';
import { STUCK_DAYS, stuckSteps, type HomeGoal, type WeekSpan } from '@/lib/goals/home';
import { weekInstants } from '@/lib/goals/links';
import { isCurrent } from '@/lib/goals/reviews';
import type { RunListing } from '@/lib/goals/runs';
import { loadRunsStartedSince } from '@/lib/goals/runs-store';
import { periodOf } from '@/lib/goals/rhythms';
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
  /**
   * What the week's numbers need from the tree and goals.items (plan #1079),
   * or null when it could not be read. The page adds the visit days and the
   * count of what is on you (weekHealth in lib/goals/home.ts).
   */
  week: WeekReads | null;
  /** Each goal's holders by goal id: what is on you, Dash's open steps, the run going. */
  holders: Record<string, GoalHolders>;
  /** The runs going now, newest first. */
  working: RunListing[];
  /** What Put Dash to work offers (lib/goals/hand-off.ts). */
  offers: DashOffer[];
  /** The steps in Up next and below it that Dash could prepare. */
  preparable: string[];
};

/** How far back the home reads runs: past QUIET_DAYS, so a quiet goal is told from one never worked. */
const RUNS_READ_DAYS = 30;

export type WeekReads = { span: WeekSpan; dashClosedAt: string[]; stuck: number };

/**
 * The week's reads: when each of Dash's steps closed this week, and the last
 * change on each open step of yours that has had none for STUCK_DAYS.
 */
async function loadWeek(
  client: GoalsSupabaseClient,
  tree: Awaited<ReturnType<typeof loadLiveTree>>,
  { today, timeZone, now }: { today: string; timeZone: string; now: number },
): Promise<WeekReads> {
  const span = { ...periodOf('week', today), ...weekInstants(today, timeZone) };
  const cutoff = new Date(now - STUCK_DAYS * 86_400_000).toISOString();
  const [closed, untouched] = await Promise.all([
    client
      .from('items')
      .select('closed_at')
      .eq('level', 'step')
      .eq('kind', 'claude')
      .eq('status', 'done')
      .is('archived_at', null)
      .gte('closed_at', span.from)
      .lt('closed_at', span.to),
    client
      .from('items')
      .select('id, updated_at')
      .eq('level', 'step')
      .eq('kind', 'mine')
      .eq('status', 'open')
      .is('archived_at', null)
      .lt('updated_at', cutoff),
  ]);
  if (closed.error) throw new Error(`Could not read Dash's steps: ${closed.error.message}`);
  if (untouched.error) throw new Error(`Could not read your steps: ${untouched.error.message}`);
  const updatedAt = new Map(
    (untouched.data ?? []).map((row) => [row.id as string, row.updated_at as string]),
  );
  return {
    span,
    dashClosedAt: (closed.data ?? []).map((row) => row.closed_at as string),
    stuck: stuckSteps(tree.goals, tree.byGoal, updatedAt, now),
  };
}

/**
 * What the Goals home reads (plan #1077), apart from what Dash did, which is
 * loadDoneSince: the live tree once, which Today and the goal lines share,
 * and each goal's newest status. `supabase` is the ordinary signed-in client,
 * for the flags in public.raised_items.
 */
export async function loadHome(
  client: GoalsSupabaseClient,
  supabase: Db,
  {
    userId,
    today,
    timeZone,
    now,
  }: { userId: string; today: string; timeZone: string; now: number },
): Promise<Home> {
  const tree = await loadLiveTree(client, { today });
  const since = new Date(now - RUNS_READ_DAYS * 86_400_000).toISOString();
  const [input, week, runs] = await Promise.all([
    // Its reviews double as the goal lines' statuses; a failed read of them
    // leaves the statuses off the lines rather than the page.
    loadTodayInput(client, supabase, { userId, today, tree, now }),
    // A failed read says so in the week's section rather than failing the page.
    loadWeek(client, tree, { today, timeZone, now }).catch((): WeekReads | null => null),
    // A failed read leaves the board without Dash's part and offers nothing.
    loadRunsStartedSince(client, since).catch((): RunListing[] => []),
  ]);
  const { reviews } = input;
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
  const holders = goalHolders({ goals, byGoal: tree.byGoal, onYou: ranked, runs, now });
  return {
    today: ranked.slice(0, TODAY_CAP),
    later: ranked.slice(TODAY_CAP),
    goals,
    week,
    holders: Object.fromEntries(holders),
    working: runs.filter((run) => isGoing(run, now)),
    offers: dashOffers({ goals, byGoal: tree.byGoal, onYou: ranked, holders, runs, now }),
    preparable: preparableSteps({ byGoal: tree.byGoal, onYou: ranked, runs, now }),
  };
}
