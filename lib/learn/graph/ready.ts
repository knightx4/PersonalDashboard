import { prerequisiteMap, readyToLearn, type Concept, type Graph } from './model';

/**
 * What to learn next, across subjects.
 *
 * `readyToLearn` answers the question inside one graph; this puts a subject
 * name on each answer, orders them and cuts the list to what fits on a screen.
 * Pure, so the order is testable against a graph written by hand, and the
 * reading that feeds it lives in `load.ts`.
 */

/** How many rows the screen shows. Settled in plan #298. */
export const READY_LIMIT = 8;

export type ReadySubject = {
  id: string;
  name: string;
};

export type ReadyConcept = {
  concept: Concept;
  subjectId: string;
  subjectName: string;
  /**
   * Edges between this concept and the nearest goal you have named, counted
   * upwards. Null when no goal in the subject sits above it.
   */
  stepsToGoal: number | null;
};

/**
 * How far each concept is from the nearest goal.
 *
 * One walk down from all the goals at once through the prerequisite links, so
 * a concept reached from two goals keeps the shorter of the two. A concept the
 * walk never reaches has nothing above it that you asked for, and gets no
 * number.
 */
export function stepsToGoal(graph: Graph, goalConceptIds: string[]): Map<string, number> {
  const prerequisites = prerequisiteMap(graph);
  const steps = new Map<string, number>();
  const queue: string[] = [];

  for (const id of goalConceptIds) {
    if (!prerequisites.has(id) || steps.has(id)) continue;
    steps.set(id, 0);
    queue.push(id);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const next = (steps.get(current) ?? 0) + 1;
    for (const prerequisiteId of prerequisites.get(current) ?? []) {
      if (steps.has(prerequisiteId)) continue;
      steps.set(prerequisiteId, next);
      queue.push(prerequisiteId);
    }
  }

  return steps;
}

/** What could be started in one subject, each row carrying its distance. */
export function readyInSubject(
  graph: Graph,
  subject: ReadySubject,
  goalConceptIds: string[],
): ReadyConcept[] {
  const steps = stepsToGoal(graph, goalConceptIds);

  return readyToLearn(graph).map((concept) => ({
    concept,
    subjectId: subject.id,
    subjectName: subject.name,
    stepsToGoal: steps.get(concept.id) ?? null,
  }));
}

/**
 * Worst first, inside what you asked for.
 *
 * A concept with no goal above it sorts after every concept that has one, so a
 * subject you have named nothing in stays out of the way until the ones you
 * have are exhausted.
 */
const STATE_RANK: Record<Concept['state'], number> = {
  misconception: 0,
  shaky: 1,
  unknown: 2,
  known: 3,
};

/**
 * The order the screen shows, and the cut.
 *
 * Closest to a goal first, which is plan #298's answer: a goal you typed is the
 * only thing in the graph that says what "now" is for. Ties go to the concept
 * in the worse state, since a misconception is doing damage while an untested
 * claim is only missing, and then to the name so the same graph renders the
 * same way twice.
 */
export function rankReady(rows: ReadyConcept[], limit: number = READY_LIMIT): ReadyConcept[] {
  return [...rows]
    .sort((a, b) => {
      const distanceA = a.stepsToGoal ?? Number.POSITIVE_INFINITY;
      const distanceB = b.stepsToGoal ?? Number.POSITIVE_INFINITY;
      if (distanceA !== distanceB) return distanceA - distanceB;

      const stateA = STATE_RANK[a.concept.state];
      const stateB = STATE_RANK[b.concept.state];
      if (stateA !== stateB) return stateA - stateB;

      const byName = a.concept.name.localeCompare(b.concept.name);
      if (byName !== 0) return byName;

      return a.subjectName.localeCompare(b.subjectName);
    })
    .slice(0, limit);
}
