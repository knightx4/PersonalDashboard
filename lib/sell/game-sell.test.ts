/**
 * What is actually different about routing a board game.
 *
 * The router itself is shared with books and already tested; these cover the
 * two places games diverge — a flat shipping assumption instead of Media Mail,
 * and no buyback path to compete with — plus the search string, which is the
 * weakest link in the whole feature because a title is not an ISBN.
 */
import { describe, expect, it } from 'vitest';
import { GAME_SHIP_FLAT_CENTS, MEDIA_MAIL_1LB_CENTS, netSelf } from '@/lib/sell/pricing';
import { routeSellDecision } from '@/lib/sell/route';
import { gamePriceQuery } from '@/lib/sell/game-query';

describe('game shipping assumption', () => {
  it('is the flat $5 it was asked to be', () => {
    expect(GAME_SHIP_FLAT_CENTS).toBe(500);
  });

  it('is used instead of Media Mail, which cannot legally carry a game', () => {
    const price = 4000;
    const asGame = netSelf({ expectedPriceCents: price, shippingCents: GAME_SHIP_FLAT_CENTS });
    const asBook = netSelf({ expectedPriceCents: price });

    expect(asGame.shippingCents).toBe(GAME_SHIP_FLAT_CENTS);
    expect(asBook.shippingCents).toBe(MEDIA_MAIL_1LB_CENTS);
    // The game ships dearer, so its net is lower on the same asking price.
    expect(asGame.netCents).toBeLessThan(asBook.netCents);
  });
});

describe('routing a game', () => {
  const route = (expectedSelfListCents: number | null, netFloorCents: number) =>
    routeSellDecision({
      expectedSelfListCents,
      buybackQuoteCents: null,
      shippingCents: GAME_SHIP_FLAT_CENTS,
      netFloorCents,
    });

  it('lists one that clears the floor', () => {
    const result = route(6000, 1000);
    expect(result.path).toBe('list_individually');
    expect(result.netBuybackCents).toBeNull();
  });

  it('lots one worth something but under the floor', () => {
    expect(route(2000, 5000).path).toBe('lot');
  });

  it('donates one worth nothing after costs', () => {
    expect(route(300, 1000).path).toBe('donate');
  });

  it('never routes to buyback, because nothing buys games back', () => {
    for (const price of [300, 2000, 6000, 25_000]) {
      expect(route(price, 1000).path).not.toBe('buyback');
    }
  });

  it('donates when there is no price at all rather than guessing', () => {
    const result = route(null, 1000);
    expect(result.path).toBe('donate');
    expect(result.netSelfCents).toBeNull();
  });
});

describe('gamePriceQuery', () => {
  it('pins the year when it is known, to separate editions', () => {
    const { query } = gamePriceQuery({
      name: 'Catan',
      yearPublished: 1995,
      publisher: 'Kosmos',
    });
    expect(query).toBe('Catan 1995 board game');
  });

  it('still asks something sensible with only a title', () => {
    const { query } = gamePriceQuery({
      name: 'Wingspan',
      yearPublished: null,
      publisher: null,
    });
    expect(query).toBe('Wingspan board game');
  });

  it('steers the estimator away from expansions and spare parts', () => {
    const { hint } = gamePriceQuery({
      name: 'Catan',
      yearPublished: 1995,
      publisher: 'Kosmos',
    });
    expect(hint).toContain('Kosmos');
    expect(hint).toMatch(/expansion/i);
  });
});
