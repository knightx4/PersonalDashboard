import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PLAN_UPDATE_COLUMNS, planUpdateFromRow, type PlanUpdate } from './updates';

/** How many updates a feature's page reads: the latest, and the Activity tab's history. */
export const PLAN_UPDATES_LIMIT = 20;

/**
 * Dash's updates on one feature, newest first (plan #1666). Empty when there
 * are none, and when the read fails: the page still opens without them.
 */
export async function loadFeatureUpdates(
  supabase: SupabaseClient,
  userId: string,
  featureId: string,
): Promise<PlanUpdate[]> {
  const { data, error } = await supabase
    .from('plan_updates')
    .select(PLAN_UPDATE_COLUMNS)
    .eq('user_id', userId)
    .eq('feature_id', featureId)
    .order('created_at', { ascending: false })
    .limit(PLAN_UPDATES_LIMIT);
  if (error || !data) return [];
  return (data as Record<string, unknown>[])
    .map(planUpdateFromRow)
    .filter((update): update is PlanUpdate => update !== null);
}

/**
 * When each feature last had an update, by feature id (plan #1834). Empty
 * when there are none and when the read fails.
 */
export async function loadLatestUpdateTimes(
  supabase: SupabaseClient,
  userId: string,
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from('plan_updates')
    .select('feature_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error || !data) return {};
  const latest: Record<string, string> = {};
  for (const row of data as { feature_id: string; created_at: string }[]) {
    if (!(row.feature_id in latest)) latest[row.feature_id] = row.created_at;
  }
  return latest;
}
