import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { PlacementPiece } from '@/lib/learn/levels/placement';

/**
 * The reads and the one write a placement run needs (plans #2292.2, #2292.5). Asking
 * and answering are Practice Flow's own (answer-store.ts), so a placement's
 * answers write evidence exactly as a practice run's do.
 */

/** The topics of the subject's lens, in the order they joined it. */
export async function loadLensOrder(learn: LearnSupabaseClient, userId: string, subjectId: string): Promise<string[]> {
  const { data, error } = await learn
    .from('lens_targets')
    .select('topic_id, created_at, lens:lenses!inner(subject_id)')
    .eq('user_id', userId)
    .eq('lens.subject_id', subjectId)
    .order('created_at')
    .order('topic_id');
  if (error) throw new Error(`Reading the subject's lens failed: ${error.message}`);
  return [...new Set(((data ?? []) as unknown as { topic_id: string }[]).map((row) => row.topic_id))];
}

/** Every piece of the subject's laid-out units, with its unit's place. */
export async function loadPlacementPieces(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<PlacementPiece[]> {
  const [pieces, units] = await Promise.all([
    learn
      .from('plan_pieces')
      .select('id, unit_id, ordinal, title, cell_ids, passed_at, held_at')
      .eq('user_id', userId)
      .eq('subject_id', subjectId),
    learn.from('curriculum_units').select('id, ordinal').eq('user_id', userId).eq('subject_id', subjectId),
  ]);
  if (pieces.error) throw new Error(`Reading the subject's pieces failed: ${pieces.error.message}`);
  if (units.error) throw new Error(`Reading the subject's units failed: ${units.error.message}`);
  const unitOrdinal = new Map(((units.data ?? []) as { id: string; ordinal: number }[]).map((u) => [u.id, u.ordinal]));
  return (
    (pieces.data ?? []) as {
      id: string;
      unit_id: string;
      ordinal: number;
      title: string;
      cell_ids: string[] | null;
      passed_at: string | null;
      held_at: string | null;
    }[]
  )
    .filter((row) => unitOrdinal.has(row.unit_id))
    .map((row) => ({
      id: row.id,
      unitOrdinal: unitOrdinal.get(row.unit_id)!,
      ordinal: row.ordinal,
      title: row.title,
      cellIds: row.cell_ids ?? [],
      passed: row.passed_at !== null,
      held: row.held_at !== null,
    }));
}

/**
 * Mark the pieces a placement showed you hold as held, with a reason of
 * placement (plan #2292.5). Nothing is passed: a held piece still opens, read
 * short and asked a level higher. A piece passed or held since it was read
 * keeps what it has. Returns the ids this call marked.
 */
export async function holdPlacedPieces(learn: LearnSupabaseClient, userId: string, pieceIds: readonly string[]): Promise<string[]> {
  if (pieceIds.length === 0) return [];
  const { data, error } = await learn
    .from('plan_pieces')
    .update({ held_at: new Date().toISOString(), held_reason: 'placement' })
    .eq('user_id', userId)
    .in('id', [...pieceIds])
    .is('passed_at', null)
    .is('held_at', null)
    .select('id');
  if (error) throw new Error(`Marking the pieces you already hold failed: ${error.message}`);
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}
