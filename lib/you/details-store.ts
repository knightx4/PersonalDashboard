import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  checkDetails,
  cleanDetail,
  DETAIL_COLUMNS,
  DETAIL_KEYS,
  detailsFromRow,
  type DetailKey,
  type Details,
  type DetailsRow,
} from './details';

/**
 * Reading and writing you.details (plan #2124.1). Every call names the person
 * as well as relying on row level security, so the same functions serve a
 * service-role client.
 */

/** Their details; all six empty when they have not saved any. */
export async function getDetails(client: YouSupabaseClient, userId: string): Promise<Details> {
  const { data, error } = await client.from('details').select(DETAIL_COLUMNS).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`Reading your details failed: ${error.message}`);
  return detailsFromRow(data as DetailsRow | null);
}

/**
 * Saves the details named in the patch and leaves the others as they were,
 * creating their row on the first save. A blank value clears that detail.
 * Returns all six as saved.
 */
export async function saveDetails(
  client: YouSupabaseClient,
  userId: string,
  patch: Partial<Record<DetailKey, string | null>>,
): Promise<Details> {
  const problem = checkDetails(patch);
  if (problem) throw new Error(problem);
  const changes: Partial<Record<DetailKey, string | null>> = {};
  for (const key of DETAIL_KEYS) if (key in patch) changes[key] = cleanDetail(patch[key]);
  const { data, error } = await client
    .from('details')
    .upsert({ ...changes, user_id: userId }, { onConflict: 'user_id' })
    .select(DETAIL_COLUMNS)
    .single();
  if (error || !data) throw new Error(`Saving your details failed: ${error?.message ?? 'no row'}`);
  return detailsFromRow(data as DetailsRow);
}
