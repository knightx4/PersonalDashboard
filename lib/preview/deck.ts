/**
 * Which gallery surfaces are decks, and where their Next and their item are
 * (docs/UI-QUALITY-SPEC.md, Part 5).
 *
 * A deck is a screen you move through one item at a time, like Quick read.
 * The phone checks hold a deck to two more rules than other screens: Next
 * shows the next item with the network held, because it was drawn and its
 * picture fetched before Next was pressed, and every control and link on it
 * shows it was pressed within 100 milliseconds (tests/interaction/deck.ts).
 *
 * A surface declares itself a deck on its gallery entry in
 * app/preview/surfaces.tsx:
 *
 *   deck: { next: '#quick-read-next button[type="submit"]', item: '[data-quick-swipe]' }
 *
 * The gallery index publishes the declarations in a JSON block, as it does
 * the recorder's interactions, so scripts/check-phone.ts can read them
 * without importing the gallery's client components.
 */

export type Deck = {
  /** A CSS selector for the control that moves to the next item; the first match is pressed. */
  next: string;
  /**
   * A CSS selector for the element holding the current item. Its text, less
   * any button's, is what has to change when Next is pressed.
   */
  item: string;
};

/** The id of the JSON block on the gallery index listing each declared deck. */
export const DECKS_SCRIPT_ID = 'preview-decks';

/** Reads the declared decks back off the gallery index's HTML, keyed by surface id. */
export function readDecks(html: string): Record<string, Deck> {
  const match = html.match(new RegExp(`<script[^>]*id="${DECKS_SCRIPT_ID}"[^>]*>([\\s\\S]*?)</script>`));
  if (!match) return {};
  return JSON.parse(match[1]!) as Record<string, Deck>;
}

/** The declared decks as the index writes them, with `<` escaped so it cannot close the script. */
export function writeDecks(entries: Record<string, Deck>): string {
  return JSON.stringify(entries).replace(/</g, '\\u003c');
}
