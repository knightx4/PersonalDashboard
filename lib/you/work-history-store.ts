import type { SchemaClient } from '@/lib/ask/db';
import type { JobInput } from './work-history';

/**
 * Saving one job on You's Work & school tab, as the page's form and Dash's
 * save_job both do it (plan #2473.5). A job with an id is corrected, one
 * without is added, and either way it is marked as theirs (`edited`), so a
 * later read of the résumé leaves it alone. The job comes in checked by
 * parseJob. Every write names the user as well as relying on row level
 * security, so the connector's service-role client is held to the person
 * too. The row comes back as it is now, or null when there was no job of
 * theirs with that id.
 */
export async function saveJob(
  client: SchemaClient,
  userId: string,
  id: string | null,
  job: JobInput,
): Promise<Record<string, unknown> | null> {
  if (id) {
    const { data, error } = await client
      .from('work_history')
      .update({ ...job, edited: true })
      .eq('id', id)
      .eq('user_id', userId)
      .select('*');
    if (error) throw new Error(`Changing the job failed: ${error.message}`);
    return ((data ?? []) as Record<string, unknown>[])[0] ?? null;
  }
  const { data, error } = await client
    .from('work_history')
    .insert({ ...job, user_id: userId, edited: true })
    .select('*')
    .single();
  if (error || !data) throw new Error(`Adding the job failed: ${error?.message ?? 'no row'}`);
  return data as Record<string, unknown>;
}
