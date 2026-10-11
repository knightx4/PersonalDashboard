import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { readSourceCounts } from '@/lib/goals/rhythm-sources-store';
import {
  recordsOf,
  sourcedSpans,
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
 * A rhythm that counts itself has its source read over the periods this
 * sync touches (lib/goals/rhythm-sources-store.ts), one read per source, and
 * the plan is made again with those counts.
 *
 * Two readers at once (Todo and the Goals home) can both try to open the same
 * period; the second insert is ignored by the unique start day, and a close
 * only applies to a row still open. The daily cron runs the same sync for
 * the owner (inngest/goals/rhythms.ts), so periods close even on a day no
 * page is opened.
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
  let plan = syncPlan(live, rows, today);
  if (live.some((r) => r.source)) {
    // A source that cannot be read leaves the stored counts as they are for
    // this sync rather than failing the page; the period just closed is read
    // again on the next one.
    const counts = await readSourceCounts(
      client,
      userId,
      live,
      sourcedSpans(live, rows, plan, today),
      today,
    ).catch((error: unknown) => {
      console.warn(`[goals] rhythm sources not read: ${error instanceof Error ? error.message : 'failed'}`);
      return null;
    });
    if (counts) plan = syncPlan(live, rows, today, counts);
  }
  const writes = plan.close.length + plan.reshape.length + plan.recount.length + plan.insert.length;
  if (writes === 0) return recordsOf(rows, today);

  const closedAt = new Date().toISOString();
  const pending: PromiseLike<{ error: { message: string } | null }>[] = [
    ...plan.close.map(({ id, kept, count }) =>
      client
        .from('periods')
        .update({ kept, closed_at: closedAt, ...(count === undefined ? {} : { count }) })
        .eq('id', id)
        .is('closed_at', null),
    ),
    // A reshape and a recount of the same open row write different columns.
    ...plan.reshape.map(({ id, target, endsOn }) =>
      client.from('periods').update({ target, ends_on: endsOn }).eq('id', id).is('closed_at', null),
    ),
    ...plan.recount.map(({ id, count, kept }) =>
      kept === null
        ? client.from('periods').update({ count }).eq('id', id).is('closed_at', null)
        : client.from('periods').update({ count, kept }).eq('id', id).not('closed_at', 'is', null),
    ),
  ];
  if (plan.insert.length > 0) {
    pending.push(
      client.from('periods').upsert(
        plan.insert.map((row) => ({
          user_id: userId,
          item_id: row.itemId,
          starts_on: row.startsOn,
          ends_on: row.endsOn,
          target: row.target,
          count: row.count,
          kept: row.kept,
          closed_at: row.kept === null ? null : closedAt,
        })),
        { onConflict: 'item_id,starts_on', ignoreDuplicates: true },
      ),
    );
  }
  const results = await Promise.all(pending);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw new Error(`Could not update rhythm periods: ${failed.error.message}`);

  return recordsOf(await readPeriods(client, ids), today);
}

/**
 * Count `by` towards a rhythm's open period starting on `startsOn`, or take
 * back with a negative `by`. The count never goes below nothing. False when
 * the rhythm counts itself from a source (its count is the source's, and the
 * next sync would put it back), when that period is not there (or not open,
 * unless `closed` allows it), when there was nothing to take back, or when
 * the count moved underneath and did not settle.
 *
 * `closed` lets capture count towards a period that has already closed,
 * such as last week's for something done yesterday on a Monday (plan #1279).
 * The period's kept is then worked out again from its new count.
 */
export async function countTowards(
  client: GoalsSupabaseClient,
  itemId: string,
  startsOn: string,
  by: number,
  { closed = false }: { closed?: boolean } = {},
): Promise<boolean> {
  const { data: item, error: itemError } = await client
    .from('items')
    .select('count_source')
    .eq('id', itemId)
    .maybeSingle();
  if (itemError) throw new Error(itemError.message);
  if (item?.count_source) return false;

  // Read then write on the count read, so two ticks at once are both counted
  // rather than one overwriting the other: the loser sees nothing updated and
  // reads again.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const read = client
      .from('periods')
      .select('id, count, target, closed_at')
      .eq('item_id', itemId)
      .eq('starts_on', startsOn);
    const { data: row, error } = await (closed ? read : read.is('closed_at', null)).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return false;
    const count = row.count as number;
    const next = Math.max(0, count + by);
    if (next === count) return false;

    // A closed period is written only while still closed, and an open one
    // only while still open, so a close landing in between is read again.
    const wasClosed = row.closed_at !== null;
    const write = client
      .from('periods')
      .update(wasClosed ? { count: next, kept: next >= (row.target as number) } : { count: next })
      .eq('id', row.id as string)
      .eq('count', count);
    const { data, error: writeError } = await (
      wasClosed ? write.not('closed_at', 'is', null) : write.is('closed_at', null)
    ).select('id');
    if (writeError) throw new Error(writeError.message);
    if ((data ?? []).length > 0) return true;
  }
  return false;
}
