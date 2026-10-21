import type { SchemaClient } from '@/lib/ask/db';

/**
 * Stopping a price watch, as Home's Stop button and Dash's stop_watch both do
 * it (plan #2473.5). Only a running watch is stopped, so a watch that ended in
 * the meantime keeps its ending, and the write is scoped to the user, so a
 * borrowed id changes nothing. The row comes back as it is now, or null when
 * there was no running watch of theirs to stop.
 */
export async function stopRunningWatch(
  core: SchemaClient,
  userId: string,
  id: string,
): Promise<{ row: Record<string, unknown> | null; error: string | null }> {
  const { data, error } = await core
    .from('watches')
    .update({ status: 'stopped' })
    .eq('id', id)
    .eq('user_id', userId)
    .eq('status', 'running')
    .select('*');
  if (error) return { row: null, error: error.message };
  const rows = (data ?? []) as Record<string, unknown>[];
  return { row: rows[0] ?? null, error: null };
}
