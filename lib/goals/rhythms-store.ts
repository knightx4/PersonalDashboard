import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  recordsOf,
  syncPlan,
  type LiveRhythm,
  type PeriodRow,
  type RhythmRecord,
} from '@/lib/goals/rhythms';

/**
 * Reads and writes for rhythm periods in goals.periods (plan #928). The rules
 * are in lib/goals/rhythms.ts; this file only carries them out. Every call
 * takes the signed-in goals client, so row level security decides whose rows
 * are touched and the history trigger records each write.
 */

type Row = {
  id: string;
  item_id: string;
  starts_on: string;
  ends_on: string;
  target: number;
  count: number;
  kept: boolean | null;
  closed_at: string | null;
};

const COLUMNS = 'id, item_id, starts_on, ends_on, target, count, kept, closed_at';

const toPeriod = (row: Row): PeriodRow => ({
  id: row.id,
  itemId: row.item_id,
  startsOn: row.starts_on,
  endsOn: row.ends_on,
  target: row.target,
  count: row.count,
  kept: row.kept,
  closedAt: row.closed_at,
});

async function readPeriods(client: GoalsSupabaseClient, itemIds: string[]): Promise<PeriodRow[]> {
  if (itemIds.length === 0) return [];
  const { data, error } = await client
    .from('periods')
    .select(COLUMNS)
    .in('item_id', itemIds)
    .order('starts_on', { ascending: false })
    .limit(5000);
  if (error) throw new Error(`Could not read rhythm periods: ${error.message}`);
  return ((data ?? []) as Row[]).map(toPeriod);
}

/**
 * Bring each live rhythm's periods up to today, then return the record of
 * every rhythm in `live` and `alsoShow` (a rhythm on the page that is not
 * live, whose stored periods are shown as they are).
 *
 * Two readers at once (Todo and the Goals home) can both try to open the same
 * period; the second insert is ignored by the unique start day, and a close
 * only applies to a row still open.
 */
export async function syncRhythms(
  client: GoalsSupabaseClient,
  userId: string,
  live: LiveRhythm[],
  today: string,
  alsoShow: string[] = [],
): Promise<Map<string, RhythmRecord>> {
  const ids = [...new Set([...live.map((r) => r.id), ...alsoShow])];
  const rows = await readPeriods(client, ids);
  const plan = syncPlan(live, rows, today);
  if (plan.close.length + plan.reshape.length + plan.insert.length === 0) {
    return recordsOf(rows, today);
  }

  const closedAt = new Date().toISOString();
  const writes: PromiseLike<{ error: { message: string } | null }>[] = [
    ...plan.close.map(({ id, kept }) =>
      client
        .from('periods')
        .update({ kept, closed_at: closedAt })
        .eq('id', id)
        .is('closed_at', null),
    ),
    ...plan.reshape.map(({ id, target, endsOn }) =>
      client.from('periods').update({ target, ends_on: endsOn }).eq('id', id).is('closed_at', null),
    ),
  ];
  if (plan.insert.length > 0) {
    writes.push(
      client.from('periods').upsert(
        plan.insert.map((row) => ({
          user_id: userId,
          item_id: row.itemId,
          starts_on: row.startsOn,
          ends_on: row.endsOn,
          target: row.target,
          count: 0,
          kept: row.kept,
          closed_at: row.kept === null ? null : closedAt,
        })),
        { onConflict: 'item_id,starts_on', ignoreDuplicates: true },
      ),
    );
  }
  const results = await Promise.all(writes);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(`Could not update rhythm periods: ${failed.error.message}`);

  return recordsOf(await readPeriods(client, ids), today);
}

/**
 * Count one towards a rhythm's open period starting on `startsOn`, or take
 * one back (`by` of -1). The count never goes below nothing. False when that
 * period is not open, or the count moved underneath and did not settle.
 */
export async function countTowards(
  client: GoalsSupabaseClient,
  itemId: string,
  startsOn: string,
  by: 1 | -1,
): Promise<boolean> {
  // Read then write on the count read, so two ticks at once are both counted
  // rather than one overwriting the other: the loser sees nothing updated and
  // reads again.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: row, error } = await client
      .from('periods')
      .select('id, count')
      .eq('item_id', itemId)
      .eq('starts_on', startsOn)
      .is('closed_at', null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return false;
    const count = row.count as number;
    const next = Math.max(0, count + by);
    if (next === count) return false;

    const { data, error: writeError } = await client
      .from('periods')
      .update({ count: next })
      .eq('id', row.id as string)
      .eq('count', count)
      .is('closed_at', null)
      .select('id');
    if (writeError) throw new Error(writeError.message);
    if ((data ?? []).length > 0) return true;
  }
  return false;
}
