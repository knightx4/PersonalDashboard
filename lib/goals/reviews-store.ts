import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  activityTouches,
  goalActivity,
  latestByGoal,
  REVIEW_COLUMNS,
  toReview,
  type ActivityCollection,
  type ActivityItem,
  type ActivityPeriod,
  type ActivityProgress,
  type ActivityReading,
  type ActivityRecord,
  type GoalActivity,
  type GoalReview,
  type ReviewRow,
} from '@/lib/goals/reviews';

/**
 * Reads for each goal's status (plans #1018, #1074). The rules are in
 * lib/goals/reviews.ts; the daily run writes the rows through the connector,
 * so nothing here writes.
 *
 * The Goals pages pass the signed-in client and row level security scopes
 * it. The daily cron stage passes the service-role client with `userId`.
 */

/** How far back the newest verdict is looked for. A goal reviewed longer ago than this shows none. */
export const REVIEWS_SHOWN_FOR_DAYS = 28;

/**
 * The newest review of each goal from the last four weeks: the goal's
 * status. `isCurrent` in lib/goals/reviews.ts says whether it is today's.
 */
export async function loadLatestReviews(
  client: GoalsSupabaseClient,
  { userId, now = Date.now() }: { userId?: string; now?: number } = {},
): Promise<Map<string, GoalReview>> {
  let query = client
    .from('reviews')
    .select(REVIEW_COLUMNS)
    .gte('created_at', new Date(now - REVIEWS_SHOWN_FOR_DAYS * 24 * 60 * 60 * 1000).toISOString());
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new Error(`Could not read goal reviews: ${error.message}`);
  const reviews = ((data ?? []) as ReviewRow[])
    .map(toReview)
    .filter((r): r is GoalReview => r !== null);
  return latestByGoal(reviews);
}

/**
 * When anything was last done on each of the owner's goals, for the daily
 * brief and the offer to park (lib/goals/goal-proposals.ts): steps closed as
 * done, readings, progress entries not undone, rhythm periods with something
 * counted, and confirmed records in the goals' collections.
 */
export async function loadGoalActivity(
  client: GoalsSupabaseClient,
  userId: string,
): Promise<Map<string, GoalActivity>> {
  const [items, readings, progress, periods, records, collectionGoals] = await Promise.all([
    client
      .from('items')
      .select('id, parent_id, level, status, closed_at, approved_at, created_at, collection_id')
      .eq('user_id', userId)
      .is('archived_at', null),
    client.from('readings').select('item_id, created_at').eq('user_id', userId),
    client
      .from('progress_entries')
      .select('item_id, created_at')
      .eq('user_id', userId)
      .is('undone_at', null),
    client
      .from('periods')
      .select('item_id, ends_on, updated_at')
      .eq('user_id', userId)
      .gt('count', 0),
    // Newest first, so a long statement history loses its oldest rows to the
    // limit rather than its newest.
    client
      .from('records')
      .select('collection_id, updated_at')
      .eq('user_id', userId)
      .eq('draft', false)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(5000),
    client
      .from('collection_goals')
      .select('collection_id, goal_id')
      .eq('user_id', userId)
      .is('archived_at', null),
  ]);
  if (items.error) throw new Error(`Could not read goal activity: ${items.error.message}`);
  if (readings.error) throw new Error(`Could not read goal readings: ${readings.error.message}`);
  if (progress.error) throw new Error(`Could not read progress entries: ${progress.error.message}`);
  if (periods.error) throw new Error(`Could not read rhythm periods: ${periods.error.message}`);
  if (records.error) throw new Error(`Could not read collection records: ${records.error.message}`);
  if (collectionGoals.error) {
    throw new Error(`Could not read collection goals: ${collectionGoals.error.message}`);
  }

  const itemRows = (items.data ?? []) as (ActivityItem & { collection_id: string | null })[];
  // A collection belongs to the goals it is linked to and to the
  // information steps that fill it.
  const collections: ActivityCollection[] = [
    ...((collectionGoals.data ?? []) as { collection_id: string; goal_id: string }[]).map((row) => ({
      collection_id: row.collection_id,
      item_id: row.goal_id,
    })),
    ...itemRows.flatMap((row) =>
      row.collection_id ? [{ collection_id: row.collection_id, item_id: row.id }] : [],
    ),
  ];
  const touches = activityTouches({
    progress: (progress.data ?? []) as ActivityProgress[],
    periods: (periods.data ?? []) as ActivityPeriod[],
    records: (records.data ?? []) as ActivityRecord[],
    collections,
  });
  return goalActivity(itemRows, [...((readings.data ?? []) as ActivityReading[]), ...touches]);
}
