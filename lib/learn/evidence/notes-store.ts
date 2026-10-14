import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  NOTE_MIN_SIMILARITY,
  NOTES_PER_IDEA,
  noteLinkRows,
  staleLinkIds,
  type NoteMatch,
} from './notes';

/**
 * Linking each idea to the vault notes you wrote about it (plan #2006.3), as a
 * stage of the daily run after the dust. Every idea is matched again each day,
 * so a new or changed idea or note is picked up the next morning and a note
 * that stops matching loses its link.
 *
 * The comparing is learn.vault_note_matches (migration learn 0122), a batch of
 * ideas per call; the weights and basis are ./notes. Runs under the service
 * role, since only it may write learn.evidence_links, so every query names the
 * person.
 */

const IDEAS_PER_CALL = 50;
const ON_CONFLICT = 'user_id,target_kind,target_id,source_kind,source_id';

export type RefreshNoteEvidenceResult = {
  /** Ideas compared with the vault. */
  ideas: number;
  /** Links written or refreshed. */
  links: number;
  /** Links removed because their note no longer matches. */
  removed: number;
};

type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: NoteMatch[] | null; error: { message: string } | null }>;

export async function refreshNoteEvidence(
  learn: LearnSupabaseClient,
  userId: string,
): Promise<RefreshNoteEvidenceResult> {
  const { data: ideaRows, error: ideasError } = await learn
    .from('concepts')
    .select('id')
    .eq('user_id', userId)
    .not('embedding', 'is', null)
    .order('id');
  if (ideasError) throw new Error(`Reading ideas for note evidence failed: ${ideasError.message}`);
  const ideaIds = ((ideaRows ?? []) as { id: string }[]).map((row) => row.id);

  const rpc = learn.rpc as unknown as Rpc;
  const result: RefreshNoteEvidenceResult = { ideas: ideaIds.length, links: 0, removed: 0 };

  for (let start = 0; start < ideaIds.length; start += IDEAS_PER_CALL) {
    const batch = ideaIds.slice(start, start + IDEAS_PER_CALL);
    const { data: matches, error } = await rpc('vault_note_matches', {
      p_user_id: userId,
      p_concept_ids: batch,
      p_min_similarity: NOTE_MIN_SIMILARITY,
      p_per_idea: NOTES_PER_IDEA,
    });
    if (error) throw new Error(`Matching ideas to notes failed: ${error.message}`);
    const rows = noteLinkRows(userId, matches ?? []);

    if (rows.length > 0) {
      const { error: writeError } = await learn
        .from('evidence_links')
        .upsert(rows, { onConflict: ON_CONFLICT });
      if (writeError) throw new Error(`Writing note evidence failed: ${writeError.message}`);
      result.links += rows.length;
    }

    const { data: existing, error: readError } = await learn
      .from('evidence_links')
      .select('id, target_id, source_id')
      .eq('user_id', userId)
      .eq('target_kind', 'idea')
      .eq('source_kind', 'note')
      .in('target_id', batch);
    if (readError) throw new Error(`Reading note evidence failed: ${readError.message}`);
    const stale = staleLinkIds(
      (existing ?? []) as { id: string; target_id: string; source_id: string }[],
      rows,
    );
    if (stale.length > 0) {
      const { error: clearError } = await learn
        .from('evidence_links')
        .delete()
        .eq('user_id', userId)
        .in('id', stale);
      if (clearError) throw new Error(`Clearing old note evidence failed: ${clearError.message}`);
      result.removed += stale.length;
    }
  }
  return result;
}
