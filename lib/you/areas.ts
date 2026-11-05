import type { YouSupabaseClient } from '@/lib/you/db/schema-name';

/**
 * The names of the Goals areas that insights and Dash's questions point at
 * (you.insights.area_id and you.dash_questions.area_id, migrations-you/0036).
 *
 * The you schema cannot embed a goals table, so the loaders read the names in
 * one second query, scoped to the person. An id with no area (deleted, or
 * never theirs) is simply absent from the map.
 */
export async function areaNamesById(
  client: YouSupabaseClient,
  userId: string,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id !== ''))];
  const names = new Map<string, string>();
  if (wanted.length === 0) return names;
  const { data, error } = await client
    .schema('goals')
    .from('areas')
    .select('id, name')
    .eq('user_id', userId)
    .in('id', wanted);
  if (error) throw new Error(`Reading your areas failed: ${error.message}`);
  for (const row of (data ?? []) as { id: string; name: string }[]) names.set(row.id, row.name);
  return names;
}
