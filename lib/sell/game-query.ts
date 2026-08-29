/**
 * What to search for when pricing a board game.
 *
 * The weakest link in pricing a game. A book carries an ISBN, which names one
 * edition and nothing else; a game carries a title, and "Catan" alone matches
 * the base game, six expansions, a travel edition, a card game and a jigsaw.
 * The year narrows the edition and the publisher and hint steer the estimator
 * off the accessories.
 *
 * Its own module, not part of the loader, because the loader is server-only
 * and this is a pure string function worth testing directly.
 */
export type GamePriceSubject = {
  query: string;
  hint: string;
};

export function gamePriceQuery(game: {
  name: string;
  yearPublished: number | null;
  publisher: string | null;
}): GamePriceSubject {
  const parts = [game.name];
  if (game.yearPublished) parts.push(String(game.yearPublished));
  return {
    query: `${parts.join(' ')} board game`,
    hint: [
      'Complete used copy of the board game in good condition, sold on eBay.',
      game.publisher ? `Published by ${game.publisher}.` : null,
      'Not an expansion, promo, travel edition, or replacement part.',
    ]
      .filter(Boolean)
      .join(' '),
  };
}
