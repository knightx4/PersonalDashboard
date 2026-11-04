import 'server-only';

import { createServiceSupabase } from '@/inngest/supabase-admin';
import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { pushPorts } from '@/inngest/core/day-brief';
import { stepNames } from '@/lib/core/session-questions-store';
import {
  runSessionWaiting,
  type SessionWaitingPorts,
  type SessionWaitingResult,
  type WaitingSession,
} from '@/lib/push/session-waiting';

/**
 * The session-waiting notification run (plan #2800.4), called every minute by
 * pg_cron through /api/cron/session-waiting. What one pass does is in
 * lib/push/session-waiting.ts. The service clients bypass RLS, so each row
 * is announced to the person it names and every follow-up read names them too.
 */

type Row = {
  id: string;
  user_id: string;
  plan_item_id: string | null;
  thread_id: string | null;
  project: string | null;
  action: string;
  needs: string | null;
};

export async function runSessionWaitingJob(now: Date = new Date()): Promise<SessionWaitingResult> {
  const app = createServiceSupabase();
  const core = createCoreServiceSupabase();

  const ports: SessionWaitingPorts = {
    async unannounced(since, limit) {
      const { data, error } = await core
        .from('session_progress')
        .select('id, user_id, plan_item_id, thread_id, project, action, needs')
        .eq('state', 'waiting')
        .is('notified_at', null)
        .gte('updated_at', since.toISOString())
        .order('updated_at', { ascending: true })
        .limit(limit);
      if (error) throw new Error(`Reading the sessions waiting failed: ${error.message}`);
      const rows = (data ?? []) as Row[];
      const out: WaitingSession[] = [];
      for (const row of rows) {
        const step = row.plan_item_id ? (await stepNames(app, row.user_id, [row.plan_item_id])).get(row.plan_item_id) : undefined;
        out.push({
          id: row.id,
          userId: row.user_id,
          about: step?.name ?? (row.project ? `project ${row.project}` : 'a session'),
          needs: row.needs ?? row.action,
        });
      }
      return out;
    },
    async announce(ids, at) {
      const { error } = await core.from('session_progress').update({ notified_at: at.toISOString() }).in('id', ids);
      if (error) throw new Error(`Recording the announced sessions failed: ${error.message}`);
    },
    push(userId) {
      return pushPorts(core, userId);
    },
  };

  return runSessionWaiting(ports, now);
}
