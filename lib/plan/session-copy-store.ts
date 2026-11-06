import type { SupabaseClient } from '@supabase/supabase-js';
import { decideCopy, type CopyDecision, type OpenSession, type SessionStatus } from './session-copy';
import { progressRpcArgs } from './session-progress';

/**
 * The reads and writes of `npm run session-sync` (plan #2800.2). Every query
 * names the owner, since the service-role clients pass no RLS. Not
 * server-only: the script runs it under tsx.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, string, any>;

export type SyncClients = { core: Client; pub: Client; userId: string };

/**
 * Every open session the dispatcher or the broker started: threads whose
 * session has not ended, and projects-dispatcher runs still started.
 */
export async function openSessions(clients: SyncClients): Promise<OpenSession[]> {
  const { core, pub, userId } = clients;
  const out: OpenSession[] = [];

  const threads = await core
    .from('session_threads')
    .select('id, session_id, project_id')
    .eq('user_id', userId)
    .in('state', ['working', 'waiting', 'idle'])
    .not('session_id', 'is', null)
    .limit(200);
  if (threads.error) throw new Error(`Reading the open threads failed: ${threads.error.message}`);
  for (const t of (threads.data ?? []) as { id: string; session_id: string; project_id: string | null }[]) {
    out.push({
      sessionId: t.session_id,
      origin: 'thread',
      planRunId: null,
      planItemId: null,
      threadId: t.id,
      project: t.project_id,
    });
  }

  const runs = await pub
    .from('plan_runs')
    .select('id, plan_item_id, external_id')
    .eq('user_id', userId)
    .eq('routine_id', 'projects-dispatcher')
    .eq('status', 'started')
    .not('external_id', 'is', null)
    .limit(200);
  if (runs.error) throw new Error(`Reading the open runs failed: ${runs.error.message}`);
  const runRows = (runs.data ?? []) as { id: string; plan_item_id: string | null; external_id: string }[];
  if (runRows.length === 0) return out;

  const itemIds = [...new Set(runRows.map((r) => r.plan_item_id).filter((id): id is string => !!id))];
  const modules = new Map<string, string | null>();
  if (itemIds.length) {
    const items = await pub.from('plan_items').select('id, module').eq('user_id', userId).in('id', itemIds);
    if (items.error) throw new Error(`Reading the runs' steps failed: ${items.error.message}`);
    for (const i of (items.data ?? []) as { id: string; module: string | null }[]) modules.set(i.id, i.module);
  }
  const known = await pub.from('dev_projects').select('id').eq('user_id', userId);
  if (known.error) throw new Error(`Reading the projects failed: ${known.error.message}`);
  const projects = new Set(((known.data ?? []) as { id: string }[]).map((p) => p.id));
  for (const r of runRows) {
    const mod = r.plan_item_id ? (modules.get(r.plan_item_id) ?? null) : null;
    out.push({
      sessionId: r.external_id,
      origin: 'run',
      planRunId: r.id,
      planItemId: r.plan_item_id,
      threadId: null,
      project: mod && projects.has(mod) ? mod : null,
    });
  }
  return out;
}

export type CopyResult = { kind: 'unknown' } | ({ found: boolean } & CopyDecision);

/** Copy one session's summary into its progress row; returns what was done. */
export async function copySummary(
  clients: SyncClients,
  input: { sessionId: string; status: SessionStatus; summary: string | null; activityAt: string | null; now?: Date },
): Promise<CopyResult> {
  const { core, userId } = clients;
  const session = (await openSessions(clients)).find((s) => s.sessionId === input.sessionId);
  if (!session) return { kind: 'unknown' };

  let query = core
    .from('session_progress')
    .select('id, updated_at')
    .eq('user_id', userId)
    .eq('session_id', input.sessionId);
  query = session.planItemId ? query.eq('plan_item_id', session.planItemId) : query.is('plan_item_id', null);
  const existing = await query.maybeSingle();
  if (existing.error) throw new Error(`Reading the progress row failed: ${existing.error.message}`);
  const row = existing.data as { id: string; updated_at: string } | null;

  const decision = decideCopy({
    origin: session.origin,
    status: input.status,
    summary: input.summary,
    activityAt: input.activityAt,
    rowUpdatedAt: row?.updated_at ?? null,
  });

  if (decision.kind === 'touch') {
    const touched = await core
      .from('session_progress')
      .update({ updated_at: (input.now ?? new Date()).toISOString() })
      .eq('user_id', userId)
      .eq('id', row!.id);
    if (touched.error) throw new Error(`Touching the progress row failed: ${touched.error.message}`);
    return { ...decision, found: true };
  }

  const args = progressRpcArgs(userId, {
    sessionId: input.sessionId,
    state: decision.state,
    action: decision.action,
    needs: null,
    planRunId: session.planRunId,
    planItemId: session.planItemId,
    threadId: session.threadId,
    project: session.project,
  });
  const written = await core.rpc('report_session_progress', args);
  if (written.error) throw new Error(`Writing the progress row failed: ${written.error.message}`);
  return { ...decision, found: !!row };
}
