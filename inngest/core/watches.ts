import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { pushPorts } from '@/inngest/core/day-brief';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { sendToPerson } from '@/lib/push/send';
import { readLowestPrice } from '@/lib/watch/read-price';
import { belowOf, runWatches, type WatchesSummary, type WatchPorts, type WatchRow } from '@/lib/watch/run';

/**
 * The hourly watch run (plan #1293), called by pg_cron through
 * /api/cron/watches (supabase/migrations/0141_watches_hourly.sql).
 *
 * The rules are lib/watch/run.ts; this wires them to core.watches,
 * core.watch_readings and the person's push subscriptions. The service role
 * bypasses RLS, so every write names the watch's own user.
 */

const WATCH_COLUMNS =
  'id, user_id, title, url, reading, condition, report_times, ends_at, status, fired_value, fired_at, reported_at';

/** numeric comes back from PostgREST as a number or a string. */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function watchPorts(core: CoreSupabaseClient, now: Date): WatchPorts {
  return {
    async running() {
      const { data, error } = await core.from('watches').select(WATCH_COLUMNS).eq('status', 'running');
      if (error) throw new Error(`Reading the running watches failed: ${error.message}`);
      return ((data ?? []) as Record<string, unknown>[]).map(
        (row): WatchRow => ({
          ...(row as unknown as WatchRow),
          condition: (row.condition ?? {}) as WatchRow['condition'],
          report_times: (row.report_times ?? []) as string[],
          fired_value: numberOrNull(row.fired_value),
        }),
      );
    },

    read(watch) {
      const below = belowOf(watch.condition);
      return readLowestPrice(watch.url, below === null ? {} : { below });
    },

    async saveReading(row) {
      const { error } = await core.from('watch_readings').insert(row);
      if (error) throw new Error(`Saving the reading failed: ${error.message}`);
    },

    async recent(watch, limit) {
      const { data, error } = await core
        .from('watch_readings')
        .select('error')
        .eq('watch_id', watch.id)
        .eq('user_id', watch.user_id)
        .order('taken_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error(`Reading the recent readings failed: ${error.message}`);
      return (data ?? []) as { error: string | null }[];
    },

    async fired(watch, value, at) {
      const { error } = await core
        .from('watches')
        .update({ fired_value: value, fired_at: at.toISOString() })
        .eq('id', watch.id)
        .eq('user_id', watch.user_id);
      if (error) throw new Error(`Recording the fired price failed: ${error.message}`);
    },

    async end(watch) {
      const { error } = await core
        .from('watches')
        .update({ status: 'ended' })
        .eq('id', watch.id)
        .eq('user_id', watch.user_id)
        .eq('status', 'running');
      if (error) throw new Error(`Ending the watch failed: ${error.message}`);
    },

    async push(userId, payload) {
      const push = pushPorts(core, userId);
      if (!push) return false;
      const result = await sendToPerson(push, userId, payload, now);
      return result.sent > 0;
    },
  };
}

export async function runWatchCheck(now: Date = new Date()): Promise<WatchesSummary> {
  const core = createCoreServiceSupabase();
  return runWatches(watchPorts(core, now), now);
}
