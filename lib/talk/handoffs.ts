import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { CORE_SCHEMA, type CoreSupabaseClient } from '@/lib/core/db/schema-name';
import type { FireRoutineResult } from '@/lib/feedback/routine';
import type { DashHandoff } from './handoff';

/**
 * The requests Ask Dash handed to the backup routine (plan #1402), kept in
 * core.dash_handoffs (core migration 0143). Every read and write goes
 * through the person's own client, so RLS keeps them to their rows.
 */

const SELECT = 'id, conversation_id, turn_id, request, status, run_id, error, created_at';

type HandoffRow = {
  id: string;
  conversation_id: string;
  turn_id: string | null;
  request: string;
  status: DashHandoff['status'];
  run_id: string | null;
  error: string | null;
  created_at: string;
};

function toHandoff(row: HandoffRow): DashHandoff {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    turnId: row.turn_id,
    request: row.request,
    status: row.status,
    runId: row.run_id,
    error: row.error,
    createdAt: row.created_at,
  };
}

/** Keeps a request as pending, before the answer that hands it on is written. */
export async function insertHandoff(
  core: CoreSupabaseClient,
  userId: string,
  conversationId: string,
  request: string,
): Promise<DashHandoff> {
  const { data, error } = await core
    .from('dash_handoffs')
    .insert({ user_id: userId, conversation_id: conversationId, request })
    .select(SELECT)
    .single();
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Keeping the hand-off failed: ${error.message}`);
  return toHandoff(data as HandoffRow);
}

/** Ties hand-offs to the answer that announced them. */
export async function attachHandoffs(core: CoreSupabaseClient, ids: readonly string[], turnId: string): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await core.from('dash_handoffs').update({ turn_id: turnId }).in('id', [...ids]).is('turn_id', null);
  if (error) throw new Error(`Tying the hand-off to the answer failed: ${error.message}`);
}

/** Removes the hand-offs of an answer that was not kept, so nothing is started for it. */
export async function discardHandoffs(core: CoreSupabaseClient, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await core.from('dash_handoffs').delete().in('id', [...ids]).eq('status', 'pending');
  if (error) throw new Error(`Removing the hand-off failed: ${error.message}`);
}

/** Records what starting the routine for one hand-off produced. */
export async function markHandoffFired(
  core: CoreSupabaseClient,
  id: string,
  fired: FireRoutineResult,
): Promise<DashHandoff['status']> {
  const status = fired.ok ? 'fired' : 'failed';
  const { error } = await core
    .from('dash_handoffs')
    .update(
      fired.ok
        ? { status, run_id: fired.runId, fired_at: new Date().toISOString() }
        : { status, error: fired.error.slice(0, 1000), finished_at: new Date().toISOString() },
    )
    .eq('id', id);
  if (error) console.error('the hand-off was not marked', error.message);
  return status;
}

/** The hand-offs of one conversation still waiting on the routine. */
export async function loadOpenHandoffs(core: CoreSupabaseClient, conversationId: string): Promise<DashHandoff[]> {
  const { data, error } = await core
    .from('dash_handoffs')
    .select(SELECT)
    .eq('conversation_id', conversationId)
    .in('status', ['pending', 'fired'])
    .order('created_at', { ascending: true });
  assertSchemaExposed(error, CORE_SCHEMA);
  if (error) throw new Error(`Reading the hand-offs failed: ${error.message}`);
  return ((data ?? []) as HandoffRow[]).map(toHandoff);
}
