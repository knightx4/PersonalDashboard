import { curriculumRows } from '@/lib/learn/graph/curriculum-view';
import { isSettled, prerequisiteMap } from '@/lib/learn/graph/model';
import type { LessonTrack } from './choose';

/**
 * Which unit's check the top-up writes (LEARN-LESSONS-SPEC, "The unit check";
 * plan #971). Pure, over what the chooser already read.
 *
 * A track offers the check for its latest done unit: the last done unit before
 * the first that is not, as `curriculumRows` reads them. Only that one, so a
 * track that had several units done before checks existed is offered one
 * check rather than a pile of them. A unit is offered its check once, whether
 * it was answered, skipped or never reached.
 *
 * The unit's concepts are its goals and everything they rest on that no
 * earlier unit's goals also rest on, less anything not known or sharp: those
 * are what the question is written from, and what a right answer marks
 * tested. A unit with none of its own has nothing to check.
 */

export type UnitCheckDue = {
  subjectId: string;
  subjectName: string;
  unitId: string;
  /** The unit's own concepts that are known or sharp, in the graph's order. */
  conceptIds: string[];
};

/** Every concept `ids` rest on, and `ids` themselves, whatever their state. */
function beneath(ids: readonly string[], prerequisites: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const queue = ids.filter((id) => prerequisites.has(id));
  for (const id of queue) seen.add(id);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const below of prerequisites.get(current) ?? []) {
      if (seen.has(below)) continue;
      seen.add(below);
      queue.push(below);
    }
  }
  return seen;
}

/** The check a track is due, or null when it has none to offer. */
export function unitCheckDue(track: LessonTrack, checked: ReadonlySet<string>): UnitCheckDue | null {
  if (track.units.length === 0) return null;
  const { rows } = curriculumRows([...track.units], [...track.goals], track.graph);

  let latest = -1;
  for (const [index, row] of rows.entries()) {
    if (row.state !== 'done') break;
    latest = index;
  }
  if (latest < 0) return null;
  const row = rows[latest]!;
  if (checked.has(row.unit.id)) return null;

  const prerequisites = prerequisiteMap(track.graph);
  const goalIds = (goals: typeof row.goals) => goals.map((goal) => goal.conceptId!);
  const earlier = beneath(
    rows.slice(0, latest).flatMap((before) => goalIds(before.goals)),
    prerequisites,
  );
  const own = beneath(goalIds(row.goals), prerequisites);
  const conceptIds = track.graph.concepts
    .filter((concept) => own.has(concept.id) && !earlier.has(concept.id) && isSettled(concept))
    .map((concept) => concept.id);
  if (conceptIds.length === 0) return null;

  return { subjectId: track.subjectId, subjectName: track.name, unitId: row.unit.id, conceptIds };
}

/** Concepts named to the writer and the marker, at most. A unit rarely has more. */
export const CHECK_CONCEPTS_NAMED = 12;

/**
 * The line above a check's title, built here so it always names the right
 * track: "You finished this unit of your Economics track. One question on it,
 * if you want it."
 */
export function unitCheckWhy(trackName: string): string {
  return `You finished this unit of your ${trackName.trim()} track. One question on it, if you want it.`;
}
