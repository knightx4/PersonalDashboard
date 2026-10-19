import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * Which subjects are archived, for the background work that must pass them by
 * (plan #2355.4).
 *
 * An archived subject has `archived_at` set (learn 0189). The hourly sweeps
 * and the preparation choose subjects afresh on every run, so leaving an
 * archived one out of each choice is all it takes: a sweep that had already
 * chosen it when it was archived finishes, and none starts after. Restoring
 * sets `archived_at` back to null, and the next run picks the subject up
 * again with nothing else to undo.
 */

const CHUNK = 200;

/** The person's archived subjects. The service role is not narrowed, so the person is named. */
export async function archivedSubjectIds(learn: LearnSupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await learn
    .from('subjects')
    .select('id')
    .eq('user_id', userId)
    .not('archived_at', 'is', null);
  if (error) throw new Error(`Reading your archived subjects failed: ${error.message}`);
  return new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
}

/**
 * Of these subjects, the archived ones. For a sweep that has gathered subject
 * ids from another table across accounts, such as the channels waiting to be
 * judged; the ids already say whose they are.
 */
export async function archivedAmong(learn: LearnSupabaseClient, subjectIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(subjectIds)];
  const found = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await learn
      .from('subjects')
      .select('id')
      .in('id', ids.slice(i, i + CHUNK))
      .not('archived_at', 'is', null);
    if (error) throw new Error(`Reading which subjects are archived failed: ${error.message}`);
    for (const row of (data ?? []) as { id: string }[]) found.add(row.id);
  }
  return found;
}
