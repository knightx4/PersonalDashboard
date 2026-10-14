import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { createEssay } from '@/lib/learn/essays/store';

/**
 * Starts an essay from a research brief (plan #2023.5): a new essay whose
 * question is the brief's and whose pins include the brief, so the brief's
 * positions and sources stay to hand beside the draft. Nothing from the
 * brief is copied into the draft.
 *
 * An essay already started from this brief is opened again rather than a
 * second one made: the pin is the record, found by jsonb containment.
 */
export async function startEssayFromBrief(
  learn: LearnSupabaseClient,
  userId: string,
  brief: { id: string; question: string },
): Promise<string> {
  const { data, error } = await learn
    .from('essays')
    .select('id')
    .eq('user_id', userId)
    .contains('brief', { pinned: [{ kind: 'brief', id: brief.id }] })
    .order('created_at', { ascending: true })
    .limit(1);
  if (error) throw new Error(`Could not look for an essay on this brief: ${error.message}`);
  const existing = (data ?? [])[0] as { id: string } | undefined;
  if (existing) return existing.id;
  return createEssay(learn, userId, [{ kind: 'brief', id: brief.id, title: brief.question }], brief.question);
}
