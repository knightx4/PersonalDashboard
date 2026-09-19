import { isSettled, type Concept, type Graph } from './model';
import type { ReadySubject } from './ready';

/**
 * Settled claims, oldest-checked first, across subjects.
 *
 * The mirror of `ready.ts`: that one orders what could be started next, this
 * one orders what has already been settled and has gone longest without being
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
 *
 * One age for both kinds of settled claim, which is #653's answer A: a claim
 * you waved through waits the same month as one you answered a question
 * about, and the two interleave oldest first.
 */
export const RECHECK_EVERY = 5;
export const RECHECK_AFTER_DAYS = 30;

export type SettledConcept = {
  concept: Concept;
  subjectId: string;
  subjectName: string;
  /**
   * Which of the two dates `settledAt` is: the day a question about it was
   * answered, or the day you said you already knew it. Read by the screens,
   * which say different things about the two.
   */
  established: 'tested' | 'declared';
  /**
   * When the claim was last settled, by whichever of the two routes
   * `established` names. Never null here.
   */
  settledAt: string;
};

/**
 * The one date a claim carries, and which route put it there.
 *
 * A claim is settled by an answer or by your word, and the database refuses a
 * row holding both dates, so there is one date to order by rather than a
 * choice between two. Null when there is no date to use: a claim known by
 * inference has neither, an old wave-through written before the date was
 * stored has none either, and a date that will not parse is no date. Ordering
 * by a missing one would be inventing it.
 */
export function settledOn(
  concept: Concept,
): Pick<SettledConcept, 'established' | 'settledAt'> | null {
  const established = concept.established;
  if (established !== 'tested' && established !== 'declared') return null;

  const settledAt = established === 'tested' ? concept.testedAt : concept.declaredAt;
  if (settledAt === null || Number.isNaN(new Date(settledAt).getTime())) return null;

  return { established, settledAt };
}

/**
 * Whether a claim is one a re-check could ask about.
 *
 * `known` or `sharp`, and a usable date from one of the two routes above. A
 * claim marked known by inference is left out however old it is, because
 * nobody has ever said anything about it.
 */
export function isRecheckable(concept: Concept): boolean {
  return isSettled(concept) && settledOn(concept) !== null;
}

/** The settled claims in one subject that carry a date to order them by. */
export function settledInSubject(graph: Graph, subject: ReadySubject): SettledConcept[] {
  return graph.concepts.flatMap((concept) => {
    if (!isSettled(concept)) return [];
    const on = settledOn(concept);
    return on ? [{ concept, subjectId: subject.id, subjectName: subject.name, ...on }] : [];
  });
}

/**
 * Longest since it was settled, first.
 *
 * A claim you answered about and one you waved through are ordered together on
 * the one date each carries, which is #653's answer A. Ties go to the name and
 * then to the subject, the same tie-break `rankReady` uses, so the same rows
 * come back in the same order twice. Compared as instants rather than as
 * strings: the columns are timestamptz and two rows written in different
 * offsets sort wrongly as text.
 */
export function rankByLastChecked(rows: SettledConcept[]): SettledConcept[] {
  return [...rows].sort((a, b) => {
    const byDate = new Date(a.settledAt).getTime() - new Date(b.settledAt).getTime();
    if (byDate !== 0) return byDate;

    const byName = a.concept.name.localeCompare(b.concept.name);
    if (byName !== 0) return byName;

    return a.subjectName.localeCompare(b.subjectName);
  });
}

/** Long enough since it was settled to be worth asking again. */
export function oldEnough(settledAt: string, now: Date): boolean {
  return new Date(settledAt).getTime() <= now.getTime() - RECHECK_AFTER_DAYS * 24 * 60 * 60 * 1000;
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
 * Longest unchecked first, and only from what was settled more than
 * `RECHECK_AFTER_DAYS` ago. Ranked here rather than trusted from the caller,
 * so a list read in any order gives the same question.
 */
export function claimToRecheck(rows: SettledConcept[], now: Date): SettledConcept | null {
  const old = rankByLastChecked(rows).filter((row) => oldEnough(row.settledAt, now));
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
    .flatMap((concept) => {
      if (!isSettled(concept)) return [];
      const on = settledOn(concept);
      return on && oldEnough(on.settledAt, now) ? [{ concept, settledAt: on.settledAt }] : [];
    })
    .sort((a, b) => {
      const byDate = new Date(a.settledAt).getTime() - new Date(b.settledAt).getTime();
      return byDate !== 0 ? byDate : a.concept.name.localeCompare(b.concept.name);
    });

  return old[0]?.concept ?? null;
}
