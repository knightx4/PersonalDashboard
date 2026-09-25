import 'server-only';

import { CONTEXT_COLUMNS, toContextItem, type ContextItem, type ContextRow } from '@/lib/goals/context';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';

/**
 * Reads and writes for context on a goal (lib/goals/context.ts). Row level
 * security keeps them to your own rows, and the history trigger records each
 * change.
 */

/** Every context row on a goal, dismissed ones included; the page filters. */
export async function loadContext(client: GoalsSupabaseClient, goalId: string): Promise<ContextItem[]> {
  const { data, error } = await client
    .from('context')
    .select(CONTEXT_COLUMNS)
    .eq('item_id', goalId)
    .order('created_at');
  if (error) throw new Error(`Could not read the goal's context: ${error.message}`);
  return ((data ?? []) as ContextRow[]).map(toContextItem);
}

/**
 * Keep a piece of context on the goal, or dismiss it. A dismissed row stays,
 * so Claude does not propose it again. False when it is not a row of yours.
 */
export async function setContextStatus(
  client: GoalsSupabaseClient,
  id: string,
  status: 'kept' | 'dismissed',
): Promise<boolean> {
  const { data, error } = await client.from('context').update({ status }).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}
