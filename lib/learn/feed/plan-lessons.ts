import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * A learning goal's lessons live on its plan, not in Learn now (plan #1143).
 *
 * A lesson written from a piece's page is a `lesson` card like any other, so
 * the deck, and the counts that decide when it is topped up, leave out lesson
 * cards whose track is an active goal's. Every other card of a goal's track
 * still comes, the unit check among them. A goal archived later has its
 * lessons back in the deck, since its track is then an ordinary one.
 */

/**
 * The tracks of the person's active open goals. Through the person's session
 * RLS narrows the read; the top-up passes `userId`, since the service role is
 * not narrowed.
 */
export async function goalTrackIds(supabase: LearnSupabaseClient, userId?: string): Promise<string[]> {
  let query = supabase
    .from('aims')
    .select('subject_id')
    .is('archived_at', null)
    .is('list_source', null)
    .not('subject_id', 'is', null);
  if (userId) query = query.eq('user_id', userId);
  const { data, error } = await query;
  if (error) throw new Error(`Reading your goals' subjects failed: ${error.message}`);
  return [...new Set(((data ?? []) as { subject_id: string }[]).map((row) => row.subject_id))];
}

/**
 * The PostgREST `or` filter keeping every card but the lessons of these
 * tracks, or null when there are none to leave out. A card of another kind
 * passes on its reason, and a lesson with no track on its track.
 */
export function notPlanLessons(tracks: readonly string[]): string | null {
  if (tracks.length === 0) return null;
  return `reason.neq.lesson,subject_id.is.null,subject_id.not.in.(${tracks.join(',')})`;
}
