/**
 * The order of the Learn now deck (LEARN-NOW-SPEC, "The order of the deck").
 *
 * A section can make a card for each of its ideas, and those cards are written
 * at the same moment, so newest first put them back to back: three cards from
 * "Tell (archaeology)" in a row. Picks for one theme are written together too,
 * which put three geopolitics cards in a row.
 *
 * So the deck is dealt from a larger pool, one card at a time. The next card
 * is the first in the pool's own order (returning cards, then newest ready,
 * then skipped) that does not share an article with any of the last
 * `ARTICLE_GAP` cards dealt, and, where possible, is not for the same theme or
 * goal as the card before it. When every card left clashes, the one whose
 * article was seen longest ago goes next, so the deck never runs dry.
 *
 * Pure, so the rule is tested directly.
 */

/** Cards dealt between two from the same article, when the pool allows it. */
export const ARTICLE_GAP = 4;

/** How many times the page size is read from the database to deal a page from. */
export const POOL_FACTOR = 4;

export type Spreadable = {
  /** The article's title. */
  article: string;
  /** The theme, goal or field the card was picked for, or null. */
  target: string | null;
};

/** How badly `card` would sit after `history` (oldest first). Zero is no clash. */
function clash(card: Spreadable, history: readonly Spreadable[]): number {
  let penalty = 0;
  for (let back = 1; back <= Math.min(ARTICLE_GAP, history.length); back += 1) {
    if (history[history.length - back]!.article === card.article) {
      // The nearer the last card from this article, the worse.
      penalty += (ARTICLE_GAP - back + 1) * 10;
      break;
    }
  }
  const previous = history[history.length - 1];
  if (card.target && previous?.target === card.target) penalty += 1;
  return penalty;
}

/**
 * Deal `count` cards from `pool`, in the pool's order where nothing clashes.
 * `recent` is what the deck already holds, oldest first, so a page loaded
 * later carries on the spacing from the one before it.
 */
export function spreadDeck<T extends Spreadable>(
  pool: readonly T[],
  recent: readonly Spreadable[],
  count: number,
): T[] {
  const left = [...pool];
  const history: Spreadable[] = [...recent];
  const dealt: T[] = [];
  while (dealt.length < count && left.length > 0) {
    let best = 0;
    let bestPenalty = Number.POSITIVE_INFINITY;
    for (const [index, card] of left.entries()) {
      const penalty = clash(card, history);
      if (penalty < bestPenalty) {
        best = index;
        bestPenalty = penalty;
        if (penalty === 0) break;
      }
    }
    const [next] = left.splice(best, 1);
    dealt.push(next!);
    history.push(next!);
  }
  return dealt;
}
