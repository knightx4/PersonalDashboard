/**
 * A phrase somebody selected in a claim, and whether it can seed a chain.
 *
 * Growth trigger 5 takes its seed from the browser, so the phrase arrives as
 * a string a form posted and is worth exactly as much as any other thing a
 * form posted. These are the two checks made before it is spent on: it is
 * short enough to be a phrase rather than a paste, and it actually comes from
 * the claim it says it came from.
 *
 * Pure and separate from the action so both can be tested without a network.
 */

/** Longer than this and it is a paragraph, not a phrase to go deeper on. */
export const MAX_SELECTION = 200;

/**
 * One phrase, with its whitespace flattened.
 *
 * A selection crossing a line break in the rendered claim carries the newline
 * with it, and the same phrase selected twice must not read as two different
 * goals. Flattening is also what makes the check below work against a claim
 * that wrapped on screen.
 */
export function normaliseSelection(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

/**
 * Is this phrase really out of that claim?
 *
 * The offer is only ever drawn over the claim, so a selection that is not in
 * it came from somewhere other than the page. Refusing it costs nothing and
 * stops the concept page from becoming a second, unlabelled way to type any
 * goal at all -- with the claim attached to it as context it never came from.
 */
export function fromClaim(selection: string, claim: string): boolean {
  const phrase = normaliseSelection(selection);
  if (phrase.length === 0) return false;
  return normaliseSelection(claim).toLowerCase().includes(phrase.toLowerCase());
}
