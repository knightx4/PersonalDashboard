import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { UnitForCheck } from './write-unit-check';

/**
 * The reads and writes around a unit check (plan #971), shared by the top-up
 * that writes one (service role) and the press that marks one (the person's
 * session). Every query names the person, so both clients read the same rows.
 */

/** The unit and its concepts as the writer and the marker are given them. */
export async function loadUnitForCheck(
  learn: LearnSupabaseClient,
  userId: string,
  input: { unitId: string; trackName: string; conceptIds: readonly string[] },
): Promise<UnitForCheck | null> {
  const [unit, concepts] = await Promise.all([
    learn
      .from('curriculum_units')
      .select('title, covers, outcome')
      .eq('id', input.unitId)
      .eq('user_id', userId)
      .maybeSingle(),
    input.conceptIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : learn
          .from('concepts')
          .select('id, name, claim')
          .eq('user_id', userId)
          .in('id', [...input.conceptIds]),
  ]);
  if (unit.error) throw new Error(`Reading the unit failed: ${unit.error.message}`);
  if (concepts.error) throw new Error(`Reading the unit's ideas failed: ${concepts.error.message}`);
  const row = unit.data as { title: string; covers: string | null; outcome: string | null } | null;
  if (!row) return null;
  const byId = new Map(
    ((concepts.data ?? []) as { id: string; name: string; claim: string }[]).map((concept) => [concept.id, concept]),
  );
  return {
    trackName: input.trackName,
    title: row.title,
    covers: row.covers,
    outcome: row.outcome,
    // In the order the check was written from.
    concepts: input.conceptIds.flatMap((id) => {
      const concept = byId.get(id);
      return concept ? [{ name: concept.name, claim: concept.claim }] : [];
    }),
  };
}

/**
 * Mark the unit's concepts tested after a right answer. Only concepts still
 * known or sharp: one that became shaky since the check was written keeps
 * what the later answer said. The state stays; what changes is that it now
 * rests on an answer rather than on your word, so the declared date goes.
 * Returns how many were marked.
 */
export async function markUnitConceptsTested(
  learn: LearnSupabaseClient,
  userId: string,
  conceptIds: readonly string[],
): Promise<number> {
  if (conceptIds.length === 0) return 0;
  const { data, error } = await learn
    .from('concept_state')
    .update({ established: 'tested', tested_at: new Date().toISOString(), declared_at: null })
    .eq('user_id', userId)
    .in('concept_id', [...conceptIds])
    .in('state', ['known', 'sharp'])
    .select('concept_id');
  if (error) throw new Error(`Marking the unit's ideas tested failed: ${error.message}`);
  return (data ?? []).length;
}
