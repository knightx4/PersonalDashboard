import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceSupabase } from '@/inngest/supabase-admin';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { pushPorts } from '@/inngest/core/day-brief';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { countDevInbox } from '@/lib/dev/inbox-count';
import {
  runDashFinishedFor,
  type DashFinishedPorts,
  type DashFinishedResult,
  type EndedRun,
} from '@/lib/push/dash-finished-run';

/**
 * The finished-work notification run (plan #2389.3), called every five
 * minutes by pg_cron through /api/cron/dash-finished
 * (supabase/migrations/0260_dash_finished_cron.sql).
 *
 * Works each person with a plan run that changed in the last day: nobody else
 * can have anything new to announce. What one pass does for a person is in
 * lib/push/dash-finished-run.ts. The service clients bypass RLS, so every
 * read and write names the person.
 */

/** How far back a changed run makes its person worth a look. */
const LOOKBACK_HOURS = 24;

/** Enough rows to find every active person; the job runs every five minutes. */
const PEOPLE_ROWS = 2000;

export function dashFinishedPorts(app: SupabaseClient, core: CoreSupabaseClient): DashFinishedPorts {
  return {
    async settings(userId) {
      const { data, error } = await app
        .from('dash_finish_notifications')
        .select('enabled, announced_through')
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw new Error(`Reading the finished-work setting failed: ${error.message}`);
      // No row until something writes one: on, with nothing announced.
      const row = data as { enabled: boolean; announced_through: string | null } | null;
      return { enabled: row?.enabled ?? true, announcedThrough: row?.announced_through ?? null };
    },

    async working(userId, since) {
      const { data, error } = await app
        .from('plan_runs')
        .select('id')
        .eq('user_id', userId)
        .eq('status', 'started')
        .gte('created_at', since.toISOString())
        .limit(1);
      if (error) throw new Error(`Reading the runs in progress failed: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async ended(userId, after, until) {
      const { data, error } = await app
        .from('plan_runs')
        .select('status, updated_at')
        .eq('user_id', userId)
        .in('status', ['finished', 'failed'])
        .gt('updated_at', after)
        .lte('updated_at', until.toISOString())
        .order('updated_at', { ascending: true })
        .limit(500);
      if (error) throw new Error(`Reading the ended runs failed: ${error.message}`);
      return ((data ?? []) as { status: EndedRun['status']; updated_at: string }[]).map((row) => ({
        status: row.status,
        updatedAt: row.updated_at,
      }));
    },

    inbox(userId) {
      return countDevInbox(app, userId);
    },

    async announce(userId, through) {
      const { error } = await app
        .from('dash_finish_notifications')
        .upsert(
          { user_id: userId, announced_through: through, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' },
        );
      if (error) throw new Error(`Recording the announced runs failed: ${error.message}`);
    },

    push(userId) {
      return pushPorts(core, userId);
    },
  };
}

export type DashFinishedSummary = {
  people: number;
  results: { userId: string; result: DashFinishedResult }[];
  failed: string[];
};

export async function runDashFinished(now: Date = new Date()): Promise<DashFinishedSummary> {
  const app = createServiceSupabase();
  const core = createCoreServiceSupabase();

  const since = new Date(now.getTime() - LOOKBACK_HOURS * 3_600_000).toISOString();
  const { data, error } = await app
    .from('plan_runs')
    .select('user_id')
    .gte('updated_at', since)
    .order('updated_at', { ascending: false })
    .limit(PEOPLE_ROWS);
  if (error) throw new Error(`Reading the recent runs failed: ${error.message}`);
  const people = [...new Set(((data ?? []) as { user_id: string }[]).map((row) => row.user_id))];

  const ports = dashFinishedPorts(app, core);
  const summary: DashFinishedSummary = { people: people.length, results: [], failed: [] };
  for (const userId of people) {
    try {
      summary.results.push({ userId, result: await runDashFinishedFor(ports, userId, now) });
    } catch (err) {
      // One person's failure is tried again in five minutes; the rest go on.
      summary.failed.push(err instanceof Error ? err.message : String(err));
    }
  }
  return summary;
}
