import { describe, expect, it } from 'vitest';
import { ARTICLE_GAP, spreadDeck, type Spreadable } from './spread';

/** The order of the Learn now deck (LEARN-NOW-SPEC, "The order of the deck"). */

type Card = Spreadable & { id: string };

function card(id: string, article: string, target: string | null = null): Card {
  return { id, article, target };
}

const ids = (cards: Card[]) => cards.map((one) => one.id);

describe('dealing the deck', () => {
  it('keeps the pool order when nothing clashes', () => {
    const pool = [card('a', 'A'), card('b', 'B'), card('c', 'C')];
    expect(ids(spreadDeck(pool, [], 3))).toEqual(['a', 'b', 'c']);
  });

  it('spreads the ideas from one section apart', () => {
    const pool = [
      card('tell0', 'Tell'),
      card('tell1', 'Tell'),
      card('tell2', 'Tell'),
      card('a', 'A'),
      card('b', 'B'),
      card('c', 'C'),
      card('d', 'D'),
      card('e', 'E'),
      card('f', 'F'),
      card('g', 'G'),
      card('h', 'H'),
    ];
    const dealt = ids(spreadDeck(pool, [], pool.length));
    expect(dealt.slice(0, 5)).toEqual(['tell0', 'a', 'b', 'c', 'd']);
    const tells = dealt.flatMap((id, index) => (id.startsWith('tell') ? [index] : []));
    expect(tells).toEqual([0, ARTICLE_GAP + 1, 2 * (ARTICLE_GAP + 1)]);
  });

  it('carries the spacing on from the cards already in the deck', () => {
    const pool = [card('tell1', 'Tell'), card('a', 'A')];
    expect(ids(spreadDeck(pool, [{ article: 'Tell', target: null }], 2))).toEqual(['a', 'tell1']);
  });

  it('puts a card for another theme between two for the same theme where it can', () => {
    const pool = [card('m', 'Maginot Line', 'geo'), card('b', 'Buffer state', 'geo'), card('r', 'Reciprocity', 'peers')];
    expect(ids(spreadDeck(pool, [], 3))).toEqual(['m', 'r', 'b']);
  });

  it('still deals every card when all of them clash, oldest article first', () => {
    const pool = [card('x1', 'X'), card('y1', 'Y'), card('x2', 'X'), card('y2', 'Y')];
    expect(ids(spreadDeck(pool, [], 4))).toEqual(['x1', 'y1', 'x2', 'y2']);
  });

  it('deals no more than asked', () => {
    expect(spreadDeck([card('a', 'A'), card('b', 'B')], [], 1)).toHaveLength(1);
  });
});
