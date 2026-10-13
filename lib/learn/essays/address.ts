/**
 * Where selveyknight.com serves a published essay (plan #1863.11). A link
 * between published essays points here, and the Publish card names it. Kept
 * apart from publish.ts so the card does not bundle the note parser.
 */
export const ESSAY_ADDRESS_PREFIX = '/writing/';

/** The address of a published essay on the site. */
export function essayAddress(slug: string): string {
  return `${ESSAY_ADDRESS_PREFIX}${slug}`;
}
