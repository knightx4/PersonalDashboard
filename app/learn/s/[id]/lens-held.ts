import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { lensHeld, type LensHeld } from '@/lib/learn/levels/lenses';
import { loadLens, loadTopicNames } from '@/lib/learn/levels/lens-store';
import { readCells } from '@/lib/learn/levels/model';
import { loadTopicMap } from '@/lib/learn/levels/store';

/**
 * A subject's lens for its page (plan #2307.1): its id, for the Levels link,
 * and what it holds, for the header. The id survives the held levels failing
 * to read, so the link does not go with them.
 */
export async function loadSubjectLens(
  learn: LearnSupabaseClient,
  userId: string,
  subjectId: string,
): Promise<{ id: string; held: LensHeld | null } | null> {
  const { data } = await learn
    .from('lenses')
    .select('id')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .limit(1)
    .maybeSingle();
  const id = (data as { id: string } | null)?.id ?? null;
  if (!id) return null;
  try {
    const found = await loadLens(learn, id);
    if (!found) return { id, held: null };
    const [map, names] = await Promise.all([loadTopicMap(learn), loadTopicNames(learn)]);
    return { id, held: lensHeld(found.lens, map, readCells(map), names) };
  } catch (error) {
    console.error('[learn subject] lens held', error instanceof Error ? error.message : error);
    return { id, held: null };
  }
}
