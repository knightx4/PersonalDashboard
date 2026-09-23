import 'server-only';

import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { CURRICULUM_MODEL, writeCurriculum } from './curriculum';
import type { CurriculumResult } from './curriculum-payload';

/**
 * Reading and writing a track's curriculum (LEARN-GRAPH-SPEC, "The
 * curriculum"), through the person's own session. RLS limits every row to
 * their own, and the table takes inserts and reads only: a curriculum is
 * written once and goes with its track.
 */

export type StoredUnit = {
  id: string;
  ordinal: number;
  title: string;
  covers: string;
  outcome: string;
};

export async function loadCurriculum(
  supabase: LearnSupabaseClient,
  subjectId: string,
): Promise<StoredUnit[]> {
  const { data, error } = await supabase
    .from('curriculum_units')
    .select('id, ordinal, title, covers, outcome')
    .eq('subject_id', subjectId)
    .order('ordinal');
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Reading the curriculum failed: ${error.message}`);
  return (data ?? []) as StoredUnit[];
}

export type EnsuredCurriculum =
  | {
      ok: true;
      units: StoredUnit[];
      /** The unit the first question falls in, when one was named. */
      goalUnitId: string | null;
      written: boolean;
    }
  | { ok: false; detail: string };

/**
 * The track's curriculum, written now if it has none.
 *
 * A track that already has one keeps it: the curriculum is fixed once made,
 * which is what the owner asked for. When two requests race to write one, the
 * unique ordinal lets only the first through, and the second reads what the
 * first wrote.
 */
export async function ensureCurriculum(
  supabase: LearnSupabaseClient,
  userId: string,
  subject: { id: string; name: string },
  asked: string | null,
  /** Units the person wrote for a custom track, in their order. */
  ownUnits?: readonly string[],
): Promise<EnsuredCurriculum> {
  const existing = await loadCurriculum(supabase, subject.id);
  if (existing.length > 0) return { ok: true, units: existing, goalUnitId: null, written: false };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  let result: CurriculumResult = {
    ok: false,
    detail: 'Writing a curriculum needs ANTHROPIC_API_KEY to be set.',
  };
  if (apiKey) {
    const spend = collectSpend();
    result = await writeCurriculum({
      subject: subject.name,
      asked,
      units: ownUnits,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(userId, 'write-curriculum', spend.reports);
  }
  // Units the person wrote are theirs whether or not the model could describe
  // them: the curriculum is kept with the titles alone.
  const written = result.ok;
  if (!result.ok && ownUnits && ownUnits.length > 0) {
    result = {
      ok: true,
      units: ownUnits.map((title) => ({ title, covers: '', outcome: '' })),
      goalUnit: null,
    };
  }
  if (!result.ok) return result;

  const { data, error } = await supabase
    .from('curriculum_units')
    .insert(
      result.units.map((unit, index) => ({
        user_id: userId,
        subject_id: subject.id,
        ordinal: index + 1,
        title: unit.title,
        covers: unit.covers,
        outcome: unit.outcome,
        write_model: written ? CURRICULUM_MODEL : null,
      })),
    )
    .select('id, ordinal, title, covers, outcome');
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) {
    // Written by another request in the meantime: that one stands.
    const raced = await loadCurriculum(supabase, subject.id);
    if (raced.length > 0) return { ok: true, units: raced, goalUnitId: null, written: false };
    return { ok: false, detail: `Saving the curriculum failed: ${error.message}` };
  }

  const units = ((data ?? []) as StoredUnit[]).sort((a, b) => a.ordinal - b.ordinal);
  const goalUnitId = result.goalUnit === null ? null : (units[result.goalUnit]?.id ?? null);
  return { ok: true, units, goalUnitId, written: true };
}

/** File a goal under a unit. Only a goal not filed yet, so a goal is never moved. */
export async function fileGoalUnder(
  supabase: LearnSupabaseClient,
  goalId: string,
  unitId: string,
): Promise<void> {
  const { error } = await supabase
    .from('goals')
    .update({ unit_id: unitId })
    .eq('id', goalId)
    .is('unit_id', null);
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error) throw new Error(`Filing the goal under its unit failed: ${error.message}`);
}
