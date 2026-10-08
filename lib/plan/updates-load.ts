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
