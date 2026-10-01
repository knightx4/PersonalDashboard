import 'server-only';

import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { teachingOrder, type OrderableReading } from '@/lib/learn/graph/model';

/**
 * A reading list's readings in teaching order, when the graph has something
 * to say about them (plan #1394).
 *
 * Readings carry the claim they were queued for but not its subject, so the
 * subjects come from the claims, and the order is worked out over every
 * subject the list touches at once: edges never cross subjects, so each one
 * comes out in its own teaching order and they interleave by arrival.
 *
 * Only the claim ids and the edges are read. `teachingOrder` needs nothing
 * else, and a full `loadGraph` per subject would also read every claim's text,
 * state and mentions to throw them away.
 *
 * `taught` is true when at least two readings sit on claims the graph holds,
 * which is when the order on the page is the graph's rather than the order the
 * readings arrived in. Fewer than that and the list comes back as it went in,
 * without reading the graph at all.
 *
 * Nothing is written. The stored positions stay as they were, so a new reading
 * still goes at the end and the order is worked out again the next time the
 * list is shown. A failure reading the graph costs the order and nothing else:
 * the list still draws, in the order it was added.
 */
export async function inTeachingOrder<T extends OrderableReading>(
  supabase: LearnSupabaseClient,
  readings: T[],
): Promise<{ readings: T[]; taught: boolean }> {
  const unchanged = { readings, taught: false };

  const tied = readings.filter((reading) => reading.conceptId !== null);
  if (tied.length < 2) return unchanged;
  const conceptIds = [...new Set(tied.map((reading) => reading.conceptId!))];

  const { data: homes, error: homeError } = await supabase
    .from('concepts')
    .select('subject_id')
    .in('id', conceptIds);
  if (homeError || !homes || homes.length === 0) return unchanged;

  const subjectIds = [
    ...new Set((homes as Array<{ subject_id: string }>).map((row) => row.subject_id)),
  ];

  const [{ data: conceptRows, error: conceptError }, { data: edgeRows, error: edgeError }] =
    await Promise.all([
      supabase.from('concepts').select('id').in('subject_id', subjectIds),
      supabase
        .from('concept_edges')
        .select('prerequisite_id, dependent_id')
        .in('subject_id', subjectIds),
    ]);
  if (conceptError || edgeError) return unchanged;

  const concepts = (conceptRows ?? []) as Array<{ id: string }>;
  const known = new Set(concepts.map((concept) => concept.id));
  const placed = tied.filter((reading) => known.has(reading.conceptId!)).length;
  if (placed < 2) return unchanged;

  const edges = ((edgeRows ?? []) as Array<{ prerequisite_id: string; dependent_id: string }>).map(
    (row) => ({ prerequisiteId: row.prerequisite_id, dependentId: row.dependent_id }),
  );

  return { readings: teachingOrder(readings, { concepts, edges }), taught: true };
}
