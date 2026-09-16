import type { Concept, KnowledgeState } from '@/lib/learn/graph/model';

/**
 * The claim a piece of reading is for.
 *
 * Read off the concept wherever it is needed, rather than copied onto the
 * reading when the reading is queued. That is the choice the whole of #375
 * rests on: nothing is stored twice, so a claim you have re-probed since
 * queueing searches on where you stand now rather than on where you stood in
 * March, and there is one answer to "what is this reading about" instead of
 * two that can disagree.
 *
 * Pure, with no client anywhere near it, because the two halves that use it
 * are a model prompt and a track title -- neither of which is a thing to test
 * through a database.
 */

export type Aim = {
  /**
   * The claim itself, not the concept's short name. "money supply" is a filing
   * label; "an increase in the money supply raises prices only once output is
   * at capacity" is the thing that can be got wrong.
   */
  claim: string;
  state: KnowledgeState;
  /** What is believed instead, when the state is `misconception`. */
  misconception: string | null;
};

/** What a concept says about itself, in the shape a search wants. */
export function aimFor(concept: Concept): Aim {
  return {
    claim: concept.claim,
    state: concept.state,
    misconception: concept.misconception,
  };
}

/**
 * The aim as one line of prose.
 *
 * For the places that take a sentence rather than a shape -- a track's
 * question, the question the locate pass is given. The misconception is
 * included because "find me something that explains why this is wrong" is a
 * different search from "find me something about this", and the second one
 * hands back the introduction somebody has already read.
 */
export function aimSentence(aim: Aim): string {
  if (aim.misconception) {
    return `${aim.claim} What is currently believed instead: ${aim.misconception}`;
  }
  return aim.claim;
}
