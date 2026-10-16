import type { KnowledgeState, StateBasis } from '@/lib/learn/graph/model';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { strength } from '@/lib/learn/strength';
import { loadGradeMap } from '@/lib/learn/levels/loader-grade';
import { readCells } from '@/lib/learn/levels/model';

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

/**
 * What Learn believed about a level of a topic at the moment it asked about it
 * (plan #2179.5): the status it computes for the cell (open, implied, shown,
 * declared or missed) and the level that cell sits at, 1 to 10. The two are
 * written together or not at all, as the table's pair check requires.
 *
 * Returns null when the topic map cannot be read, or the cell is not on it. As
 * with predictedStrength, asking the question matters more than recording the
 * belief, so a failed read leaves both columns empty and says so in the log.
 */
export async function predictedCell(
  learn: LearnSupabaseClient,
  userId: string,
  cellId: string,
): Promise<{ status: string; level: number } | null> {
  try {
    const map = await loadGradeMap(learn, userId);
    const reading = readCells(map).get(cellId);
    return reading ? { status: reading.status, level: reading.level } : null;
  } catch (error) {
    console.error('[learn predicted cell]', error instanceof Error ? error.message : error);
    return null;
  }
}
