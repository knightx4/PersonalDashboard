import { rankReady, type ReadyConcept } from './ready';

/**
 * The single claim a five-minute session asks about.
 *
 * `rankReady` puts everything that could be started next in order, for a
 * screen that shows eight of them. This takes the same rows and answers a
 * narrower question: which one thing to ask about when the person is not
 * choosing. Pure, so the order is testable against rows written by hand, and
 * the reading that feeds it is `loadReadyToLearn` in `load.ts`.
 */

/** Why there is nothing to ask about. The two cases read differently. */
export type NothingToAsk = 'no-subjects' | 'all-settled';

export type OneToAsk =
  | { kind: 'ask'; row: ReadyConcept }
  | { kind: 'nothing'; because: NothingToAsk };

/**
 * The one claim, or which of the two empty cases applies.
 *
 * Ranked here rather than trusted from the caller, so a list read in any order
 * gives the same question. `subjectCount` is what separates the two empty
 * cases: with no subjects there is nothing to ask about because nothing has
 * been named yet, and with subjects but no ready rows every claim in them is
 * settled. A subject whose concepts have not been written yet has nothing left
 * to ask about either, and reads as settled.
 */
export function pickOneToAsk(rows: ReadyConcept[], subjectCount: number): OneToAsk {
  const [row] = rankReady(rows, 1);
  if (row) return { kind: 'ask', row };
  return { kind: 'nothing', because: subjectCount === 0 ? 'no-subjects' : 'all-settled' };
}
