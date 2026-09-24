/**
 * The rules for keeping Learn now ideas as concepts (LEARN-NOW-SPEC, "One idea
 * per card" and "Where ideas are kept").
 *
 * Each card teaches one idea, and each idea is saved as a concept, so a swipe
 * says what the person knows about that idea. The reads and writes are in
 * `ideas-store.ts`; what is decided here has no database in it and is tested
 * directly.
 */

import type { SwipeAction } from './card';

/**
 * Cosine similarity between two claims above which they are one idea said
 * twice. Set high on purpose: two different ideas from one article sit close
 * together, and a real idea dropped as a copy is worse than a copy shown once.
 * The call is also told the nearest ideas already held, which catches most
 * copies before this does.
 */
export const DUPLICATE_SIMILARITY = 0.9;

/**
 * The least similarity for an idea already held to be passed to the writing
 * call as one to leave out. Low, since the call judges sameness itself and a
 * list of ten loosely related ideas costs little.
 */
export const NEARBY_MIN_SIMILARITY = 0.3;

/** Characters of the section embedded when the catalogue has not embedded it yet. */
export const SECTION_QUERY_CHARS = 4_000;

/** Where the concept came from, in a sentence, for `learn.concepts.basis`. */
export function ideaBasis(article: string, section: string | null): string {
  return section
    ? `Taken from the Wikipedia article "${article}", section "${section}", for a Learn now card.`
    : `Taken from the lead of the Wikipedia article "${article}", for a Learn now card.`;
}

/** What the catalogue is asked to embed for a section with no embedding yet. */
export function sectionQueryText(article: string, section: string | null, text: string): string {
  const heading = section ? `${article}: ${section}` : article;
  return `${heading}\n\n${text.trim().slice(0, SECTION_QUERY_CHARS)}`;
}

export type StateBasis = 'tested' | 'inferred' | 'declared';

/**
 * The state a swipe writes on the card's idea, or null to leave it.
 *
 * Got it is known and Work on this is shaky, both on your word. Not now says
 * nothing about the idea. A state a test established is never overwritten by
 * a swipe: an answer is evidence, and a swipe is a claim.
 */
export function swipeState(
  swipe: SwipeAction,
  current: { established: StateBasis } | null,
): 'known' | 'shaky' | null {
  if (current?.established === 'tested') return null;
  if (swipe === 'known') return 'known';
  if (swipe === 'review') return 'shaky';
  return null;
}
