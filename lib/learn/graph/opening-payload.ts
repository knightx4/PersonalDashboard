import { z } from 'zod';

/**
 * What the ten opening claims have to be before anything is asked about them.
 *
 * Pure, so the rules can be checked without a network. Each one is a way the
 * list comes back looking fine and is not usable:
 *
 *   A heading where a claim should be. "The Phillips curve" cannot be
 *   answered from memory and cannot be wrong, so a question written against it
 *   is a question about a name. The prompt says so and this catches the ones
 *   that come back anyway.
 *
 *   The same claim twice under two names, which turns ten questions into nine
 *   and makes one part of the subject count double.
 *
 *   Too few to span anything. Four claims about a subject is a sample of one
 *   corner of it, and the point of the sweep is breadth.
 */

/** What the call asks for. */
export const TARGET_CLAIMS = 10;
/**
 * Fewer than this and the list is not a spread across a subject. Not ten,
 * because dropping a heading or a duplicate should cost that claim rather than
 * the whole sweep.
 */
export const MIN_CLAIMS = 8;

/**
 * A claim shorter than this is a heading with a full stop on it.
 *
 * Words rather than characters, and a low bar rather than a tidy one: it is
 * there to catch "The Phillips curve" and "Comparative advantage", not to
 * judge how well a real claim is written.
 */
export const MIN_CLAIM_WORDS = 6;

/**
 * How much a claim has to say beyond its own name.
 *
 * "The quantity theory of money, in the standard form" is long enough to pass
 * the word count and has still said only the name. What is left once the name
 * is taken out of it is the part somebody could be wrong about, so that is
 * what gets counted.
 */
export const MIN_WORDS_BEYOND_NAME = 5;

export const openingClaimSchema = z.object({
  name: z.string().trim().min(1).max(120),
  claim: z.string().trim().max(600).nullable().optional(),
});

export const openingPayloadSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  claims: z.array(openingClaimSchema).max(30).default([]),
  /**
   * Said out loud when the thing named is not one subject with prerequisite
   * structure in it -- "science", "everything I should know". The graph rule
   * the whole module rests on is that one survey course could plausibly cover
   * a subject, and a sweep across something broader is ten questions about
   * nothing in particular.
   */
  no_structure: z.boolean().default(false),
});

export type OpeningPayload = z.infer<typeof openingPayloadSchema>;

/** One claim to be asked about, before a question has been written for it. */
export type OpeningClaim = {
  name: string;
  claim: string;
};

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Casing, punctuation and articles removed, so two spellings of one claim match. */
function key(text: string): string {
  return text
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * A claim that is really the node's title with a full stop after it.
 *
 * Two tests, both mechanical. A claim of a few words has not said anything a
 * person could be wrong about, and a claim that is the name back again has
 * said nothing the name did not.
 */
export function isHeading(claim: OpeningClaim): boolean {
  if (words(claim.claim) < MIN_CLAIM_WORDS) return true;

  const name = key(claim.name);
  const text = key(claim.claim);
  if (text === name) return true;
  if (!text.includes(name)) return false;

  return words(text.replace(name, ' ')) < MIN_WORDS_BEYOND_NAME;
}

/**
 * The rules applied after the model has spoken.
 *
 * Order is the model's and is left alone -- the claims are a spread across a
 * subject rather than a route through it, so there is nothing to sort by.
 * A heading is dropped rather than rewritten: writing the missing half here
 * would mean inventing the claim the question is then asked against.
 */
export function normaliseClaims(payload: OpeningPayload): OpeningClaim[] {
  const seen = new Set<string>();
  const claims: OpeningClaim[] = [];

  for (const raw of payload.claims) {
    const name = raw.name.trim();
    const claim = raw.claim?.trim() ?? '';
    if (!name || !claim) continue;

    const candidate = { name, claim };
    if (isHeading(candidate)) continue;

    // Either half repeating is the same claim twice: two names for one idea,
    // and one sentence given two names.
    const nameKey = key(name);
    const claimKey = key(claim);
    if (seen.has(nameKey) || seen.has(claimKey)) continue;
    seen.add(nameKey);
    seen.add(claimKey);

    claims.push(candidate);
    if (claims.length >= TARGET_CLAIMS) break;
  }

  return claims;
}
