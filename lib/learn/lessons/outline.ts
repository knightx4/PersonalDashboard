import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import type { AimDepth } from '@/lib/learn/aims';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { CURRICULUM_MODEL, writeOutline } from '@/lib/learn/graph/curriculum';
import { OUTLINE_UNITS } from '@/lib/learn/graph/curriculum-payload';
import { loadCurriculum } from '@/lib/learn/graph/curriculum-store';

/**
 * A learning goal's whole outline (plan #1139, LEARN-LESSONS-SPEC "A goal's
 * track is outlined whole").
 *
 * A goal's track gets every unit at once, sized to the goal's depth, and
 * `subjects.outlined_at` records that it has (learn 0072). A track that
 * already has units keeps them and the outline goes after them, so the goals
 * set before this keep what they were studying. Once a track is outlined, the
 * Learn now top-up adds no unit to it.
 *
 * Two callers: saving a goal (`giveAimsTracks`), and the top-up, for a goal's
 * track that is not outlined yet because the call at saving failed or the
 * goal was set before outlines existed. Both pass a client that can write
 * the person's rows; every read and write names the person, since the top-up
 * runs with the service role.
 */

/** Postgres's unique violation: another run wrote units at these ordinals first. */
const UNIQUE_VIOLATION = '23505';

export type OutlineOutcome =
  | { outcome: 'written'; added: number }
  /** Already outlined, or another run outlined it first. */
  | { outcome: 'already' }
  | { outcome: 'failed'; detail: string };

async function markOutlined(learn: LearnSupabaseClient, userId: string, subjectId: string): Promise<void> {
  const { error } = await learn
    .from('subjects')
    .update({ outlined_at: new Date().toISOString() })
    .eq('id', subjectId)
    .eq('user_id', userId)
    .is('outlined_at', null);
  if (error) throw new Error(`Marking the subject outlined failed: ${error.message}`);
}

/**
 * Write the rest of the goal's track's outline, when it has none. Never
 * throws. The spend goes to `onSpend`, for the caller to record in its own
 * way; it is reported whether or not the units are saved.
 */
export async function ensureOutline(
  learn: LearnSupabaseClient,
  userId: string,
  track: { subjectId: string; name: string; asked: string; depth: AimDepth },
  apiKey: string | undefined,
  onSpend?: SpendSink,
): Promise<OutlineOutcome> {
  try {
    const { data: subject, error: subjectError } = await learn
      .from('subjects')
      .select('id, outlined_at')
      .eq('id', track.subjectId)
      .eq('user_id', userId)
      .maybeSingle();
    if (subjectError) throw new Error(`Reading the subject failed: ${subjectError.message}`);
    if (!subject) return { outcome: 'failed', detail: 'No subject of this person has that id.' };
    if ((subject as { outlined_at: string | null }).outlined_at) return { outcome: 'already' };

    const units = await loadCurriculum(learn, track.subjectId, userId);
    const bounds = OUTLINE_UNITS[track.depth];
    if (units.length >= bounds.max) {
      await markOutlined(learn, userId, track.subjectId);
      return { outcome: 'written', added: 0 };
    }
    if (!apiKey) return { outcome: 'failed', detail: 'Writing an outline needs ANTHROPIC_API_KEY to be set.' };

    const result = await writeOutline({
      subject: track.name,
      asked: track.asked,
      bounds,
      units,
      anthropicApiKey: apiKey,
      onSpend,
    });
    if (!result.ok) return { outcome: 'failed', detail: result.detail };

    const last = units[units.length - 1]?.ordinal ?? 0;
    const { error } = await learn.from('curriculum_units').insert(
      result.units.map((unit, index) => ({
        user_id: userId,
        subject_id: track.subjectId,
        ordinal: last + index + 1,
        title: unit.title,
        covers: unit.covers,
        outcome: unit.outcome,
        write_model: CURRICULUM_MODEL,
      })),
    );
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return { outcome: 'already' };
      return { outcome: 'failed', detail: `Saving the outline failed: ${error.message}` };
    }
    await markOutlined(learn, userId, track.subjectId);
    return { outcome: 'written', added: result.units.length };
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Could not write the outline.' };
  }
}
