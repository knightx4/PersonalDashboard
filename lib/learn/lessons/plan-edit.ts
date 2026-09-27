import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { CURRICULUM_MODEL, describeUnit } from '@/lib/learn/graph/curriculum';
import { readUnitTitle } from '@/lib/learn/graph/curriculum-payload';
import { loadCurriculum } from '@/lib/learn/graph/curriculum-store';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';

/**
 * Changing a learning goal's outline from its plan page (plan #1144,
 * LEARN-LESSONS-SPEC "Changing a plan"): move a unit, remove one, or add one
 * by name.
 *
 * Every change goes through a function in the learn schema (learn 0076),
 * called with the person's session: those check the unit is theirs, renumber
 * the track's units in one transaction, and refuse to remove a unit with a
 * passed piece. Next up on the plan is read from unit order, so it follows a
 * move without anything else changing.
 */

export type PlanEditResult = { ok: true } | { ok: false; detail: string };

/** The hint `remove_curriculum_unit` raises with for a unit that has a passed piece. */
const PASSED_PIECES_HINT = 'unit_has_passed_pieces';

/** A unit's place after moving it one step up or down, or null when it cannot go that way. */
export function placeAfterStep(
  units: readonly { id: string; ordinal: number }[],
  unitId: string,
  direction: 'up' | 'down',
): number | null {
  const ordered = [...units].sort((a, b) => a.ordinal - b.ordinal);
  const index = ordered.findIndex((unit) => unit.id === unitId);
  if (index === -1) return null;
  const to = direction === 'up' ? index - 1 : index + 1;
  if (to < 0 || to >= ordered.length) return null;
  return to + 1;
}

/** Move a unit one place up or down its track. */
export async function moveUnit(
  learn: LearnSupabaseClient,
  subjectId: string,
  unitId: string,
  direction: 'up' | 'down',
): Promise<PlanEditResult> {
  const units = await loadCurriculum(learn, subjectId);
  const place = placeAfterStep(units, unitId, direction);
  if (place === null) {
    return units.some((unit) => unit.id === unitId)
      ? { ok: true }
      : { ok: false, detail: 'That unit is not in this plan any more.' };
  }
  const { error } = await learn.rpc('move_curriculum_unit', { p_unit_id: unitId, p_to: place });
  if (error) return { ok: false, detail: `Moving the unit failed: ${error.message}` };
  return { ok: true };
}

/** Remove a unit with no passed piece, with its pieces. */
export async function removeUnit(learn: LearnSupabaseClient, unitId: string): Promise<PlanEditResult> {
  const { error } = await learn.rpc('remove_curriculum_unit', { p_unit_id: unitId });
  if (!error) return { ok: true };
  if (error.hint === PASSED_PIECES_HINT) {
    return { ok: false, detail: 'This unit has a passed piece, so it can be moved but not removed.' };
  }
  return { ok: false, detail: `Removing the unit failed: ${error.message}` };
}

/**
 * Add a unit by name at the end of the track. Dash writes what it covers and
 * its outcome when it can; without a key, or when that call fails, the unit
 * is kept with its title alone, as a custom track keeps the units a person
 * wrote. The spend is recorded either way.
 */
export async function addUnit(
  learn: LearnSupabaseClient,
  userId: string,
  subject: { id: string; name: string },
  typed: string,
): Promise<PlanEditResult> {
  const units = await loadCurriculum(learn, subject.id);
  const named = readUnitTitle(
    typed,
    units.map((unit) => unit.title),
  );
  if (!named.ok) return named;

  let covers = '';
  let outcome = '';
  let writeModel: string | null = null;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (apiKey) {
    const spend = collectSpend();
    const described = await describeUnit({
      subject: subject.name,
      units,
      title: named.title,
      anthropicApiKey: apiKey,
      onSpend: spend.sink,
    });
    await recordLearnSpend(userId, 'write-curriculum', spend.reports);
    if (described.ok) {
      covers = described.covers;
      outcome = described.outcome;
      writeModel = CURRICULUM_MODEL;
    }
  }

  const { error } = await learn.rpc('add_curriculum_unit', {
    p_subject_id: subject.id,
    p_title: named.title,
    p_covers: covers,
    p_outcome: outcome,
    p_write_model: writeModel,
  });
  if (error) return { ok: false, detail: `Adding the unit failed: ${error.message}` };
  return { ok: true };
}
