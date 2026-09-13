import { isSettled, type Concept, type Graph } from './model';
import type { ReadySubject } from './ready';

/**
 * Settled claims, oldest-checked first, across subjects.
 *
 * The mirror of `ready.ts`: that one orders what could be started next, this
 * one orders what has already been answered and has gone longest without being
 * asked about again. Pure, so the order is testable against rows written by
 * hand, and the reading that feeds it lives in `load.ts`.
 */

export type SettledConcept = {
  concept: Concept;
  subjectId: string;
  subjectName: string;
  /** When the last question about it was actually answered. Never null here. */
  testedAt: string;
};

/**
 * The settled claims in one subject that somebody has actually answered about.
 *
 * `known` and `established: 'tested'` both, and a date. A claim marked known by
 * inference, or because you said so, has no `tested_at` and is left out: there
 * is no date on something nobody has been asked about, and ordering by a
 * missing one would be inventing it. A row whose date is unparseable is left
 * out for the same reason.
 */
export function settledInSubject(graph: Graph, subject: ReadySubject): SettledConcept[] {
  return graph.concepts
    .filter(
      (concept) =>
        isSettled(concept) &&
        concept.established === 'tested' &&
        concept.testedAt !== null &&
        !Number.isNaN(new Date(concept.testedAt).getTime()),
    )
    .map((concept) => ({
      concept,
      subjectId: subject.id,
      subjectName: subject.name,
      testedAt: concept.testedAt!,
    }));
}

/**
 * Longest since you were asked, first.
 *
 * Ties go to the name and then to the subject, the same tie-break `rankReady`
 * uses, so the same rows come back in the same order twice. Compared as
 * instants rather than as strings: the column is a timestamptz and two rows
 * written in different offsets sort wrongly as text.
 */
export function rankByLastChecked(rows: SettledConcept[]): SettledConcept[] {
  return [...rows].sort((a, b) => {
    const byDate = new Date(a.testedAt).getTime() - new Date(b.testedAt).getTime();
    if (byDate !== 0) return byDate;

    const byName = a.concept.name.localeCompare(b.concept.name);
    if (byName !== 0) return byName;

    return a.subjectName.localeCompare(b.subjectName);
  });
}
