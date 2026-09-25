import 'server-only';

import type { SpendReport } from '@/lib/core/spend/pricing';
import { recordSpend, type SpendClient } from '@/lib/core/spend/record';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { CURRICULUM_MODEL, writeNextUnit } from '@/lib/learn/graph/curriculum';
import { loadGraph } from '@/lib/learn/graph/load';
import type { Graph } from '@/lib/learn/graph/model';
import type { LearnOperation } from '@/lib/learn/spend';

/**
 * Writing a track's next unit when it runs out (plan #969, LEARN-LESSONS-SPEC
 * "Units are written as you go").
 *
 * The top-up calls this for a track whose units are all done, whose last unit
 * has fewer than three concepts left, or which has no curriculum at all. One
 * Sonnet call writes one unit after the last, given the units so far, the
 * concepts the person knows, the ones they kept to work on and the lessons
 * they rated too hard. The unit is appended at the next ordinal and is fixed
 * from then on, like every other unit. Its chain is laid out later by
 * `layOutNextUnit`, when the track reaches it.
 *
 * It runs with the service role, so every read names the person and the track
 * is checked to be theirs before anything is written into it.
 */

const OPERATION: LearnOperation = 'write-next-unit';

/** Postgres's unique violation: another run appended a unit at this ordinal first. */
const UNIQUE_VIOLATION = '23505';

export type AddedUnit =
  | { outcome: 'added'; unitId: string; title: string }
  /** The track's last unit is no longer the one the need named: another run added one. */
  | { outcome: 'already-added' }
  | { outcome: 'failed'; detail: string };

type UnitRow = { id: string; ordinal: number; title: string; covers: string; outcome: string };

/**
 * What the person has shown in the track, by concept name: known or sharp is
 * known, and shaky is what they kept to work on (Work on this on a lesson, or
 * their word on the track page).
 */
export function shownInTrack(graph: Graph): { known: string[]; workingOn: string[] } {
  const known: string[] = [];
  const workingOn: string[] = [];
  for (const concept of graph.concepts) {
    if (concept.state === 'known' || concept.state === 'sharp') known.push(concept.name);
    else if (concept.state === 'shaky') workingOn.push(concept.name);
  }
  return { known: known.sort(), workingOn: workingOn.sort() };
}

async function loadUnits(learn: LearnSupabaseClient, userId: string, subjectId: string): Promise<UnitRow[]> {
  const { data, error } = await learn
    .from('curriculum_units')
    .select('id, ordinal, title, covers, outcome')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .order('ordinal');
  if (error) throw new Error(`Reading the curriculum failed: ${error.message}`);
  return (data ?? []) as UnitRow[];
}

/** The concepts of this track's lessons rated too hard, newest first. */
async function loadTooHard(learn: LearnSupabaseClient, userId: string, subjectId: string): Promise<string[]> {
  const { data, error } = await learn
    .from('feed_cards')
    .select('idea_name')
    .eq('user_id', userId)
    .eq('subject_id', subjectId)
    .eq('reason', 'lesson')
    .eq('difficulty', 'too_hard')
    .order('written_at', { ascending: false })
    .limit(40);
  if (error) throw new Error(`Reading the lessons rated too hard failed: ${error.message}`);
  const names = ((data ?? []) as { idea_name: string | null }[]).flatMap((row) => (row.idea_name ? [row.idea_name] : []));
  return [...new Set(names)];
}

/**
 * Append the next unit to the track. Never throws.
 *
 * `lastUnitId` is the track's last unit when the need was read (null for a
 * track with no curriculum). When the track's last unit is another by now, a
 * unit has been added since and nothing is written. `core` is a service-role
 * client on the core schema, for the spend ledger; the spend is recorded
 * whether or not the unit is saved.
 */
export async function addNextUnit(
  learn: LearnSupabaseClient,
  core: SpendClient,
  userId: string,
  subjectId: string,
  lastUnitId: string | null,
  apiKey: string,
): Promise<AddedUnit> {
  try {
    const { data: subject, error: subjectError } = await learn
      .from('subjects')
      .select('id, name')
      .eq('id', subjectId)
      .eq('user_id', userId)
      .maybeSingle();
    if (subjectError) throw new Error(`Reading the track failed: ${subjectError.message}`);
    if (!subject) return { outcome: 'failed', detail: 'No track of this person has that id.' };
    const name = (subject as { name: string }).name;

    const [units, graph, tooHard] = await Promise.all([
      loadUnits(learn, userId, subjectId),
      loadGraph(learn, subjectId, userId),
      loadTooHard(learn, userId, subjectId),
    ]);
    const last = units[units.length - 1] ?? null;
    if ((last?.id ?? null) !== lastUnitId) return { outcome: 'already-added' };

    const shown = shownInTrack(graph);
    const spend: SpendReport[] = [];
    const result = await writeNextUnit({
      subject: name,
      units,
      known: shown.known,
      workingOn: shown.workingOn,
      tooHard,
      anthropicApiKey: apiKey,
      onSpend: (report) => spend.push(report),
    });
    // Awaited, so the rows land before a background function is frozen.
    for (const report of spend) {
      await recordSpend(core, userId, { module: 'learn', operation: OPERATION, model: report.model, usage: report.usage });
    }
    if (!result.ok) return { outcome: 'failed', detail: result.detail };

    const { data, error } = await learn
      .from('curriculum_units')
      .insert({
        user_id: userId,
        subject_id: subjectId,
        ordinal: (last?.ordinal ?? 0) + 1,
        title: result.unit.title,
        covers: result.unit.covers,
        outcome: result.unit.outcome,
        write_model: CURRICULUM_MODEL,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return { outcome: 'already-added' };
      return { outcome: 'failed', detail: `Saving the unit failed: ${error.message}` };
    }
    return { outcome: 'added', unitId: (data as { id: string }).id, title: result.unit.title };
  } catch (error) {
    return { outcome: 'failed', detail: error instanceof Error ? error.message : 'Could not write the next unit.' };
  }
}
