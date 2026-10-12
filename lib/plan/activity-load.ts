import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  PLAN_ACTION_REF,
  stepIdFromRef,
  type ActivityDashAction,
  type ActivityRun,
  type ActivityStatusChange,
} from './activity';
import type { RunJob, RunStatus } from './run-end';

/** The most runs and Dash actions the Activity tab reads, newest first. */
export const ACTIVITY_LIMIT = 200;

/**
 * The most history rows it reads. Higher than the rest, because most rows on
 * an update change something other than the status (a position, a priority)
 * and are dropped once read.
 */
export const HISTORY_LIMIT = 1000;

export type ActivitySources = {
  blockedAt: Record<string, string>;
  runs: ActivityRun[];
  actions: ActivityDashAction[];
  history: ActivityStatusChange[];
};

/**
 * What the Activity tab reads beyond the plan itself (plan #1667): when each
 * blocked row was blocked, the runs sent at the feature's rows, what Dash
 * recorded doing to them, and each status change in `plan_history` (plan
 * #1830). The feature page spreads this whole object into `featureActivity`,
 * so `history` reaches it although the page's prop type names only the
 * first three. Each read that fails comes back empty, so the tab
 * still lists what the plan holds.
 */
export async function loadActivitySources(
  supabase: SupabaseClient,
  userId: string,
  ids: readonly string[],
): Promise<ActivitySources> {
  const sources: ActivitySources = { blockedAt: {}, runs: [], actions: [], history: [] };
  if (ids.length === 0) return sources;

  const [blocked, runs, actions, history] = await Promise.all([
    supabase
      .from('plan_items')
      .select('id, blocked_at')
      .eq('user_id', userId)
      .in('id', ids)
      .not('blocked_at', 'is', null),
    supabase
      .from('plan_runs')
      .select('id, plan_item_id, job, status, error, created_at')
      .eq('user_id', userId)
      .in('plan_item_id', ids)
      .order('created_at', { ascending: false })
      .limit(ACTIVITY_LIMIT),
    supabase
      .schema('core')
      .from('dash_actions')
      .select('id, kind, written_ref, summary, created_at')
      .eq('user_id', userId)
      .in(
        'written_ref',
        ids.map((id) => `${PLAN_ACTION_REF}${id}`),
      )
      .is('undone_at', null)
      .order('created_at', { ascending: false })
      .limit(ACTIVITY_LIMIT),
    supabase
      .from('plan_history')
      .select('id, item_id, old_status, new_status, actor, created_at')
      .eq('user_id', userId)
      .eq('action', 'update')
      .in('item_id', ids)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);

  if (blocked.error) console.error(`activity: blocked_at: ${blocked.error.message}`);
  for (const row of (blocked.data ?? []) as Array<{ id: string; blocked_at: string | null }>) {
    if (row.blocked_at) sources.blockedAt[row.id] = row.blocked_at;
  }

  if (runs.error) console.error(`activity: plan_runs: ${runs.error.message}`);
  for (const row of (runs.data ?? []) as Array<Record<string, unknown>>) {
    if (typeof row.plan_item_id !== 'string') continue;
    sources.runs.push({
      id: String(row.id),
      stepId: row.plan_item_id,
      job: row.job as RunJob,
      status: row.status as RunStatus,
      error: typeof row.error === 'string' ? row.error : null,
      createdAt: String(row.created_at),
    });
  }

  if (actions.error) console.error(`activity: dash_actions: ${actions.error.message}`);
  for (const row of (actions.data ?? []) as Array<Record<string, unknown>>) {
    const stepId = stepIdFromRef(typeof row.written_ref === 'string' ? row.written_ref : null);
    if (!stepId) continue;
    sources.actions.push({
      id: String(row.id),
      stepId,
      kind: String(row.kind),
      summary: typeof row.summary === 'string' ? row.summary : null,
      createdAt: String(row.created_at),
    });
  }

  if (history.error) console.error(`activity: plan_history: ${history.error.message}`);
  for (const row of (history.data ?? []) as Array<Record<string, unknown>>) {
    const oldStatus = typeof row.old_status === 'string' ? row.old_status : null;
    const newStatus = typeof row.new_status === 'string' ? row.new_status : null;
    if (typeof row.item_id !== 'string' || oldStatus === newStatus) continue;
    sources.history.push({
      id: String(row.id),
      stepId: row.item_id,
      oldStatus,
      newStatus,
      actor: row.actor === 'me' ? 'me' : 'claude',
      createdAt: String(row.created_at),
    });
  }

  return sources;
}
