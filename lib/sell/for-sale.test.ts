/**
 * Where a price for a given item gets looked up and kept.
 *
 * This is the decision the whole "price anything you marked for sale" idea
 * rests on, and it is made in two places at once — the loader reads the cache
 * it names, the run writes it — so a disagreement would show up as a price that
 * is fetched, billed, stored, and then never found again.
 */
import { describe, expect, it } from 'vitest';
import { priceTargetOf, type ForSaleItem } from '@/lib/sell/for-sale';
import {
  GAME_SHIP_FLAT_CENTS,
  MEDIA_MAIL_1LB_CENTS,
  shippingCentsForKind,
} from '@/lib/sell/pricing';

function item(overrides: Partial<ForSaleItem> = {}): ForSaleItem {
  return {
    inventoryItemId: '11111111-1111-1111-1111-111111111111',
    name: 'Cordless drill',
    shortName: null,
    imageUrl: null,
    categoryName: 'Tools',
    costCents: 0,
    kind: 'item',
    isbn13: null,
    bggId: null,
    authors: [],
    publisher: null,
    yearPublished: null,
    needsConfirmation: false,
    manualCents: null,
    searchTerms: [],
    ...overrides,
  };
}

describe('priceTargetOf', () => {
  it('prices a confirmed book against its ISBN', () => {
    const target = priceTargetOf(
      item({ kind: 'book', isbn13: '9780735211292', name: 'Atomic Habits' }),
    );
    expect(target).toEqual({ via: 'isbn', isbn13: '9780735211292' });
  });

  it('prices a confirmed game against its BGG id, by title', () => {
    const target = priceTargetOf(
      item({ kind: 'game', bggId: 13, name: 'Catan', yearPublished: 1995 }),
    );
    expect(target.via).toBe('bgg');
    if (target.via !== 'bgg') return;
    expect(target.bggId).toBe(13);
    expect(target.query).toContain('Catan');
  });

  it('prices anything else against the item itself, by name', () => {
    const target = priceTargetOf(item({ shortName: 'Drill' }));
    expect(target).toEqual({
      via: 'item',
      inventoryItemId: '11111111-1111-1111-1111-111111111111',
      query: 'Drill',
      hint: 'Used, in good condition, sold on eBay.',
    });
  });

  it('adds the attribute values the template marked for search', () => {
    const target = priceTargetOf(
      item({ shortName: 'Dune', searchTerms: ['Folio Society', '1st printing'] }),
    );
    expect(target.via).toBe('item');
    if (target.via !== 'item') return;
    expect(target.query).toBe('Dune Folio Society 1st printing');
  });

  it('leaves an ISBN and a BGG search alone, whatever the template marked', () => {
    // Those two are cached under an identifier shared with every other copy of
    // the same thing, so one owner's words would be written into everybody's
    // answer. An ISBN also already pins the edition.
    const isbn = priceTargetOf(
      item({ kind: 'book', isbn13: '9780735211292', searchTerms: ['Folio Society'] }),
    );
    expect(isbn).toEqual({ via: 'isbn', isbn13: '9780735211292' });

    const bgg = priceTargetOf(
      item({ kind: 'game', bggId: 13, name: 'Catan', searchTerms: ['Folio Society'] }),
    );
    expect(bgg.via === 'bgg' && bgg.query).not.toContain('Folio Society');
  });

  it('falls back to a title search while an edition is unconfirmed', () => {
    // The point of the fallback: "price everything I marked" has to include the
    // book whose printing nobody has settled, rather than skipping it silently
    // or filing a quote against an ISBN that may be the wrong one.
    const target = priceTargetOf(
      item({
        kind: 'book',
        isbn13: '9780735211292',
        needsConfirmation: true,
        name: 'Atomic Habits',
      }),
    );
    expect(target.via).toBe('item');
  });

  it('falls back the same way when a game never matched BGG', () => {
    const target = priceTargetOf(item({ kind: 'game', bggId: null, name: 'Some game' }));
    expect(target.via).toBe('item');
  });
});

describe('shippingCentsForKind', () => {
  it('uses Media Mail for books only — it may not legally carry anything else', () => {
    expect(shippingCentsForKind('book')).toBe(MEDIA_MAIL_1LB_CENTS);
    expect(shippingCentsForKind('game')).toBe(GAME_SHIP_FLAT_CENTS);
    expect(shippingCentsForKind('item')).toBe(GAME_SHIP_FLAT_CENTS);
  });
});
