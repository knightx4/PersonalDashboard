import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * Archived subjects (plan #2355). A subject is archived while
 * `learn.subjects.archived_at` is set; restoring sets it back to null, and
 * nothing else on the subject or under it changes either way.
 */

export type ArchivedSubject = {
  id: string;
  name: string;
  note: string | null;
  archivedAt: string;
};

/**
 * The Archived list (plan #2355.2): the person's archived subjects, the most
 * recently archived first. Survey subjects are not tracks and are left out,
 * as every list of subjects leaves them out.
 */
export async function loadArchivedSubjects(
  supabase: LearnSupabaseClient,
  userId: string,
): Promise<ArchivedSubject[]> {
  const { data, error } = await supabase
    .from('subjects')
    .select('id, name, note, archived_at')
    .eq('user_id', userId)
    .eq('survey', false)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });

  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Reading your archived subjects failed: ${error.message}`);

  return ((data ?? []) as { id: string; name: string; note: string | null; archived_at: string }[]).map((row) => ({
    id: row.id,
    name: row.name,
    note: row.note,
    archivedAt: row.archived_at,
  }));
}
