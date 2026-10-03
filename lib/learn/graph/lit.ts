import type { Concept } from './model';

/**
 * Whether a concept is lit on the map, and whether coming to know it is
 * recent enough to play the moment (plan #1562; docs/UI-QUALITY-SPEC.md,
 * Part 8, "A concept known").
 *
 * Lit means settled: known or sharp, the two states the screen reads as
 * "Known". The moment plays the first time a lit concept is seen, and only for
 * one known in the last two weeks, so a claim settled in March does not light
 * up as though it had just happened. A claim known by inference carries no
 * date, so it is lit without the moment.
 */

/** How long after coming to know a concept its moment can still play. */
export const LIT_RECENT_DAYS = 14;

export function isLit(concept: Pick<Concept, 'state'>): boolean {
  return concept.state === 'known' || concept.state === 'sharp';
}

/** When the concept came to be known: the day it was answered about, or the day you said so. */
export function knownAt(concept: Pick<Concept, 'testedAt' | 'declaredAt'>): string | null {
  return concept.testedAt ?? concept.declaredAt;
}

export function litRecently(
  concept: Pick<Concept, 'state' | 'testedAt' | 'declaredAt'>,
  now: Date,
): boolean {
  if (!isLit(concept)) return false;
  const at = knownAt(concept);
  if (!at) return false;
  const when = Date.parse(at);
  if (!Number.isFinite(when)) return false;
  const age = now.getTime() - when;
  return age >= -60_000 && age <= LIT_RECENT_DAYS * 24 * 60 * 60 * 1000;
}
