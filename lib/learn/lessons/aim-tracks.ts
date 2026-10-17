import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * Which tracks belong to learning goals (LEARN-LESSONS-SPEC, "What happens to
 * today's pieces"; plan #972).
 *
 * An open goal on the Goals page points at the subject it is about, in
 * `aims.subject_id` (learn 0056). Saving the goal links it
 * (`lib/learn/goal-saved.ts`); since plan #2302.2 nothing here makes a track,
 * an outline or a kind for it: the subject is prepared like any other.
 *
 * Every read names the person, since the top-up runs with the service role.
 */

/** The subject ids of the person's active goals' tracks. */
export async function loadGoalTracks(supabase: LearnSupabaseClient, userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('aims')
    .select('subject_id')
    .eq('user_id', userId)
    .is('archived_at', null)
    .is('list_source', null)
    .not('subject_id', 'is', null);
  if (error) throw new Error(`Reading your goals' subjects failed: ${error.message}`);
  return new Set(((data ?? []) as { subject_id: string }[]).map((row) => row.subject_id));
}
