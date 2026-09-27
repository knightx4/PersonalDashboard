import 'server-only';

import { createCoreServiceSupabase } from '@/inngest/core/supabase-admin';
import { createLearnServiceSupabase } from '@/inngest/learn/supabase-admin';
import { loadLessons, loadPieceIdea, loadPieceRow, type PieceIdea } from '@/lib/learn/lessons/piece-store';
import { writeLessonCard } from './lesson-top-up';

/**
 * Writing the lesson for one idea of a piece when the piece is opened and the
 * idea has none yet (plan #1141). The same call and the same stored card as
 * the top-up's lessons (`writeLessonCard`), so an idea is taught once whether
 * Learn now or the plan reached it first. Lesson cards are written only with
 * the service role, so this runs here rather than in the page's action; every
 * read and write names the person.
 */

export type PieceLessonResult = { ok: true; idea: PieceIdea } | { ok: false; detail: string };

export async function writePieceLesson(
  userId: string,
  input: { subjectId: string; pieceId: string; conceptId: string },
): Promise<PieceLessonResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, detail: 'Writing a lesson needs ANTHROPIC_API_KEY to be set.' };
  const learn = createLearnServiceSupabase();

  const piece = await loadPieceRow(learn, userId, input.subjectId, input.pieceId);
  if (!piece || !piece.concept_ids.includes(input.conceptId)) {
    return { ok: false, detail: 'That idea is not in this piece.' };
  }

  // Written already, by the top-up or another tab: show that one.
  const existing = await loadLessons(learn, userId, [input.conceptId]);
  if (!existing.has(input.conceptId)) {
    const [subject, concept] = await Promise.all([
      learn.from('subjects').select('name').eq('id', input.subjectId).eq('user_id', userId).maybeSingle(),
      learn
        .from('concepts')
        .select('id, name, claim, mastery')
        .eq('id', input.conceptId)
        .eq('user_id', userId)
        .maybeSingle(),
    ]);
    if (subject.error || !subject.data) return { ok: false, detail: 'The track is no longer there.' };
    if (concept.error || !concept.data) return { ok: false, detail: 'The idea is no longer there.' };
    const row = concept.data as { id: string; name: string; claim: string; mastery: unknown };

    const written = await writeLessonCard(
      { learn, core: createCoreServiceSupabase(), apiKey },
      userId,
      {
        subjectId: input.subjectId,
        subjectName: (subject.data as { name: string }).name,
        unitId: piece.unit_id,
        concept: {
          id: row.id,
          name: row.name,
          claim: row.claim,
          mastery: Array.isArray(row.mastery) ? row.mastery.filter((m): m is string => typeof m === 'string') : [],
        },
      },
    );
    if (written.outcome === 'failed') return { ok: false, detail: written.detail ?? 'Writing the lesson failed.' };
  }

  const idea = await loadPieceIdea(learn, userId, input.conceptId);
  return idea ? { ok: true, idea } : { ok: false, detail: 'The idea is no longer there.' };
}
