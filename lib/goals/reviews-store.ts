import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  goalActivity,
  latestByGoal,
  REVIEW_COLUMNS,
  toReview,
  type ActivityItem,
  type ActivityReading,
  type GoalActivity,
  type GoalReview,
  type ReviewRow,
} from '@/lib/goals/reviews';

/**
 * Reads for the weekly verdicts (plan #1018). The rules are in
 * lib/goals/reviews.ts; the weekly run writes the rows through the connector,
 * so nothing here writes.
 *
 * The home passes the signed-in client and row level security scopes it. The
 * weekly cron stage passes the service-role client with `userId`.
 */

/** How far back the newest verdict is looked for. A goal reviewed longer ago than this shows none. */
export const REVIEWS_SHOWN_FOR_DAYS = 28;

/** The newest verdict on each goal from the last four weeks. */
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

/** When anything was last done on each of the owner's goals, for the weekly brief. */
export async function loadGoalActivity(
  client: GoalsSupabaseClient,
  userId: string,
): Promise<Map<string, GoalActivity>> {
  const [items, readings] = await Promise.all([
    client
      .from('items')
      .select('id, parent_id, level, status, closed_at, approved_at, created_at')
      .eq('user_id', userId)
      .is('archived_at', null),
    client.from('readings').select('item_id, created_at').eq('user_id', userId),
  ]);
  if (items.error) throw new Error(`Could not read goal activity: ${items.error.message}`);
  if (readings.error) throw new Error(`Could not read goal readings: ${readings.error.message}`);
  return goalActivity(
    (items.data ?? []) as ActivityItem[],
    (readings.data ?? []) as ActivityReading[],
  );
}
