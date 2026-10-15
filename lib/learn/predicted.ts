import type { KnowledgeState, StateBasis } from '@/lib/learn/graph/model';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { strength } from '@/lib/learn/strength';

/**
 * What Learn believed about an idea at the moment it asked (plan #2179.1):
 * the strength score on that day, 0 to 1, kept to four places to match the
 * column. An idea with no state row has never been judged, so it is unknown
 * and scores 0.
 *
 * Returns null when the state cannot be read. Asking a question matters more
 * than recording what was believed when it was asked, so a failed read leaves
 * the column empty and says so in the log rather than failing the question.
 */
export async function predictedStrength(
  supabase: LearnSupabaseClient,
  conceptId: string,
  at: Date = new Date(),
): Promise<number | null> {
  const { data, error } = await supabase
    .from('concept_state')
    .select('state, established, tested_at, declared_at, review_interval_days')
    .eq('concept_id', conceptId)
    .maybeSingle();

  if (error) {
    console.error('[learn predicted strength]', error.message);
    return null;
  }
  const row = data as {
    state: KnowledgeState;
    established: StateBasis;
    tested_at: string | null;
    declared_at: string | null;
    review_interval_days: number | null;
  } | null;
  if (!row) return 0;
  return Math.round(strength(row, at) * 10_000) / 10_000;
}
