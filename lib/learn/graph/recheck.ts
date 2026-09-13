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

/**
 * One question in five goes back over old ground. Plan #370, answer C.
 *
 * Two numbers rather than one: without the age, a small graph re-asks about
 * something settled on Tuesday, which reads as the app having lost track
 * rather than as revision. When nothing is old enough the turn is skipped and
 * an ordinary question is asked instead.
 */
export const RECHECK_EVERY = 5;
export const RECHECK_AFTER_DAYS = 30;

export type SettledConcept = {
  concept: Concept;
  subjectId: string;
  subjectName: string;
  /** When the last question about it was actually answered. Never null here. */
  testedAt: string;
};

/**
 * Whether a claim is one a re-check could ask about.
 *
 * `known` and `established: 'tested'` both, and a date on it. A claim marked
 * known by inference, or because you said so, has no `tested_at` and is left
 * out: there is no date on something nobody has been asked about, and ordering
 * by a missing one would be inventing it. A date that will not parse is left
 * out for the same reason.
 */
export function isRecheckable(concept: Concept): boolean {
  return (
    isSettled(concept) &&
    concept.established === 'tested' &&
    concept.testedAt !== null &&
    !Number.isNaN(new Date(concept.testedAt).getTime())
  );
}

/** The settled claims in one subject that somebody has actually answered about. */
export function settledInSubject(graph: Graph, subject: ReadySubject): SettledConcept[] {
  return graph.concepts
    .filter(isRecheckable)
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

/** Long enough since it was last answered about to be worth asking again. */
function oldEnough(testedAt: string, now: Date): boolean {
  return new Date(testedAt).getTime() <= now.getTime() - RECHECK_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Whether the next question is a re-check.
 *
 * Counted from the questions already answered rather than from anything held
 * between them: there is no session object anywhere in this module, so the
 * fifth question is the one with four answered before it. The count is read
 * back from the stored probes, which is what makes a closed tab cost nothing.
 */
export function isRecheckTurn(answered: number): boolean {
  return (answered + 1) % RECHECK_EVERY === 0;
}

/**
 * The claim a re-check asks about, or null when nothing is old enough.
 *
 * Longest unchecked first, and only from what was last answered more than
 * `RECHECK_AFTER_DAYS` ago. Ranked here rather than trusted from the caller,
 * so a list read in any order gives the same question.
 */
export function claimToRecheck(rows: SettledConcept[], now: Date): SettledConcept | null {
  const old = rankByLastChecked(rows).filter((row) => oldEnough(row.testedAt, now));
  return old[0] ?? null;
}

/**
 * The same question inside one subject.
 *
 * A subject session already has the concepts and needs no subject name on
 * them, so this answers in concepts rather than in rows. Same cutoff, same
 * oldest-first order, same tie on the name.
 */
export function conceptToRecheck(concepts: Concept[], now: Date): Concept | null {
  const old = concepts
    .filter((concept) => isRecheckable(concept) && oldEnough(concept.testedAt!, now))
    .sort((a, b) => {
      const byDate = new Date(a.testedAt!).getTime() - new Date(b.testedAt!).getTime();
      return byDate !== 0 ? byDate : a.name.localeCompare(b.name);
    });

  return old[0] ?? null;
}
