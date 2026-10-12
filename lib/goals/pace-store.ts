import 'server-only';

import type { FiledEntry } from '@/lib/goals/capture';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import type { PaceCapture, PacePeriod } from '@/lib/goals/pace';

/**
 * The rows a goal's pace reads that the goal page does not already hold
 * (plan #1737): its rhythms' counted periods and the captures filed in the
 * window. Closed steps come from the goal's map and progress from the
 * page's progress entries. The rule is in lib/goals/pace.ts.
 *
 * Captures are read for the whole account over the window and matched to
 * the goal by `activeDays`, since a capture's lines name the items they
 * filed on inside its `filed` list rather than in a column.
 */
export async function loadPaceRows(
  client: GoalsSupabaseClient,
  itemIds: readonly string[],
  since: string,
): Promise<{ periods: PacePeriod[]; captures: PaceCapture[] }> {
  const [periods, captures] = await Promise.all([
    itemIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : client
          .from('periods')
          .select('item_id, starts_on, ends_on, count, updated_at')
          .in('item_id', [...itemIds])
          .gt('count', 0)
          .gte('ends_on', since),
    client
      .from('captures')
      .select('created_at, filed')
      .gte('created_at', `${since}T00:00:00Z`)
      .order('created_at', { ascending: true }),
  ]);
  if (periods.error) throw new Error(periods.error.message);
  if (captures.error) throw new Error(captures.error.message);
  return {
    periods: (periods.data ?? []).map((row) => ({
      itemId: row.item_id as string,
      startsOn: row.starts_on as string,
      endsOn: row.ends_on as string,
      count: row.count as number,
      updatedAt: row.updated_at as string,
    })),
    captures: (captures.data ?? []).map((row) => ({
      createdAt: row.created_at as string,
      filed: Array.isArray(row.filed) ? (row.filed as FiledEntry[]) : [],
    })),
  };
}

/**
 * Every row a pace reads for one account over the window, for the morning
 * run, which works out many goals' paces at once (plan #1738) and sorts the
 * rows by goal in paceForGoal. Read by account rather than by item, since
 * the items under the open goals run to hundreds.
 */
export async function loadAccountPaceRows(
  client: GoalsSupabaseClient,
  userId: string,
  since: string,
): Promise<{
  progress: { itemId: string; happenedOn: string }[];
  periods: PacePeriod[];
  captures: PaceCapture[];
}> {
  const [progress, periods, captures] = await Promise.all([
    client
      .from('progress_entries')
      .select('item_id, happened_on')
      .eq('user_id', userId)
      .is('undone_at', null)
      .gte('happened_on', since),
    client
      .from('periods')
      .select('item_id, starts_on, ends_on, count, updated_at')
      .eq('user_id', userId)
      .gt('count', 0)
      .gte('ends_on', since),
    client
      .from('captures')
      .select('created_at, filed')
      .eq('user_id', userId)
      .gte('created_at', `${since}T00:00:00Z`)
      .order('created_at', { ascending: true }),
  ]);
  if (progress.error) throw new Error(progress.error.message);
  if (periods.error) throw new Error(periods.error.message);
  if (captures.error) throw new Error(captures.error.message);
  return {
    progress: (progress.data ?? []).map((row) => ({
      itemId: row.item_id as string,
      happenedOn: row.happened_on as string,
    })),
    periods: (periods.data ?? []).map((row) => ({
      itemId: row.item_id as string,
      startsOn: row.starts_on as string,
      endsOn: row.ends_on as string,
      count: row.count as number,
      updatedAt: row.updated_at as string,
    })),
    captures: (captures.data ?? []).map((row) => ({
      createdAt: row.created_at as string,
      filed: Array.isArray(row.filed) ? (row.filed as FiledEntry[]) : [],
    })),
  };
}
