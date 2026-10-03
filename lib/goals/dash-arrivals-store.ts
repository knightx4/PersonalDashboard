import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { ARRIVAL_DAYS, dashArrivals, type CloseRow } from '@/lib/goals/dash-arrivals';

const DAY_MS = 24 * 60 * 60 * 1000;
const CHUNK = 100;

/**
 * Of these finished steps, the ones Dash closed lately (plan #1561;
 * lib/goals/dash-arrivals.ts). Every close in the window is read, yours too,
 * so a later close of yours outranks Dash's.
 */
export async function loadDashArrivals(
  client: GoalsSupabaseClient,
  doneIds: readonly string[],
  now: number = Date.now(),
): Promise<string[]> {
  if (doneIds.length === 0) return [];
  const since = new Date(now - ARRIVAL_DAYS * DAY_MS).toISOString();
  const rows: CloseRow[] = [];
  for (let start = 0; start < doneIds.length; start += CHUNK) {
    const { data, error } = await client
      .from('history')
      .select('id, row_id, actor, created_at')
      .eq('table_name', 'items')
      .eq('new_values->>status', 'done')
      .in('row_id', doneIds.slice(start, start + CHUNK))
      .gte('created_at', since);
    if (error) throw new Error(`Could not read who closed the steps: ${error.message}`);
    rows.push(...((data ?? []) as CloseRow[]));
  }
  return dashArrivals(rows, now);
}
