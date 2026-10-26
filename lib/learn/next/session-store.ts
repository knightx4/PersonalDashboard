import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';

/**
 * A lesson shown in a learning session counts as read (plan #2546.3): its
 * card moves from `ready` to `opened`, which `loadSessionSubjects` reads as
 * read, so the chooser goes on to the next lesson or the check. A card
 * already acted on is left as it is.
 */
export async function markLessonShown(learn: LearnSupabaseClient, userId: string, conceptId: string): Promise<void> {
  const { error } = await learn
    .from('feed_cards')
    .update({ status: 'opened', acted_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('reason', 'lesson')
    .eq('concept_id', conceptId)
    .eq('status', 'ready');
  if (error) throw new Error(`Marking the lesson read failed: ${error.message}`);
}
