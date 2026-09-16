/**
 * Putting a claim in your own words, and what that writes.
 *
 * The claim is overwritten in place, because everything that reads a concept
 * -- the probe writer, the concept page, the subject page -- reads `claim` and
 * should read the sentence you would rather be asked about. What needs a rule
 * is the copy kept beside it: the first rewrite puts the wording you replaced
 * into `claim_original`, and every rewrite after that leaves that copy exactly
 * where it is.
 *
 * The rule is here rather than inside the action because it is the part that
 * can be wrong in a way nobody notices. A second rewrite overwriting the kept
 * copy loses the app's wording for good, and the line on the concept page that
 * says what the app first wrote would go on saying it about a sentence you
 * wrote yourself. Pure, so it can be tested without a database.
 */

/** As long as a claim the app writes. Your own sentence gets the same room. */
export const MAX_CLAIM = 1000;

/** What the two columns hold before the rewrite. */
export type KeptClaim = {
  claim: string;
  claimOriginal: string | null;
};

/**
 * The update, keyed by column so it can go straight into the client.
 *
 * `claim_original` is left out rather than set to null on a later rewrite: the
 * update must not touch the column, and null would clear it.
 */
export type ClaimPatch = {
  claim: string;
  claim_rewritten_at: string;
  claim_original?: string;
};

/** A save that changes nothing writes nothing, and does not move the date. */
export function isSameClaim(current: string, next: string): boolean {
  return current.trim() === next.trim();
}

export function rewriteClaimPatch(
  current: KeptClaim,
  next: string,
  at: Date = new Date(),
): ClaimPatch {
  const patch: ClaimPatch = {
    claim: next.trim(),
    claim_rewritten_at: at.toISOString(),
  };
  // Null means nobody has rewritten this claim yet, so what it holds now is
  // the wording worth keeping. After that the kept copy is already the app's
  // and is never written again.
  if (current.claimOriginal === null) patch.claim_original = current.claim;
  return patch;
}
