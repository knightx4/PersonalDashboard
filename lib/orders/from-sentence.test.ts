import { describe, expect, it } from 'vitest';
import { orderDraftTitle, orderFromSentenceAlone, readOrderSentenceReply } from '@/lib/orders/from-sentence';
import { linkIn, linkTitle, typedIsbn } from '@/lib/capture/shopping-text';

/**
 * What capture aimed at a Shopping list makes from what was typed (plan
 * #1950.3.1): an order from a sentence, a book from an ISBN, a saved thing
 * from its link.
 */

const TODAY = '2026-10-14';

describe('an order read from a sentence', () => {
  it('keeps the shop, the day and each line, in whole cents', () => {
    const draft = readOrderSentenceReply(
      {
        merchant: 'Target',
        order_date: '2026-10-13',
        lines: [
          { name: 'Electric kettle', quantity: 1, unit_price: 34.99, category: 'kitchen' },
          { name: 'Mugs', quantity: 4, unit_price: 6.5, category: null },
        ],
      },
      TODAY,
    );
    expect(draft).toEqual({
      merchantName: 'Target',
      orderDate: '2026-10-13',
      lines: [
        { name: 'Electric kettle', quantity: 1, unitPriceCents: 3499, categorySlug: 'kitchen' },
        { name: 'Mugs', quantity: 4, unitPriceCents: 650, categorySlug: null },
      ],
    });
    expect(orderDraftTitle(draft!)).toBe('Electric kettle and 1 more from Target');
  });

  it('takes today for a day the orders table would refuse, and one for a bad quantity', () => {
    const draft = readOrderSentenceReply(
      { order_date: '2019-01-01', lines: [{ name: 'Lamp', quantity: 0, unit_price: null }] },
      TODAY,
    );
    expect(draft).toMatchObject({ merchantName: null, orderDate: TODAY, lines: [{ quantity: 1, unitPriceCents: 0 }] });
  });

  it('answers null when no line has a name', () => {
    expect(readOrderSentenceReply({ lines: [{ name: '  ', quantity: 1 }] }, TODAY)).toBeNull();
    expect(readOrderSentenceReply('nonsense', TODAY)).toBeNull();
  });

  it('still makes one line from the sentence alone, priced by its first amount', () => {
    expect(orderFromSentenceAlone('kettle from Target for $34.99', TODAY)).toEqual({
      merchantName: null,
      orderDate: TODAY,
      lines: [{ name: 'kettle from Target', quantity: 1, unitPriceCents: 3499, categorySlug: null }],
    });
    expect(orderFromSentenceAlone('new running shoes', TODAY).lines[0]).toMatchObject({
      name: 'new running shoes',
      unitPriceCents: 0,
    });
  });
});

describe('a saved thing from its link', () => {
  it('finds the link and keeps the words around it as a note', () => {
    expect(linkIn('for the kitchen https://example.com/p/kettle-123, maybe')).toEqual({
      url: 'https://example.com/p/kettle-123',
      note: 'for the kitchen maybe',
    });
  });

  it('reads a bare address as https, and nothing without one', () => {
    expect(linkIn('rei.com/product/12345')).toEqual({ url: 'https://rei.com/product/12345', note: null });
    expect(linkIn('a green kettle')).toBeNull();
  });

  it('names a link by its page and host when the page gave no title', () => {
    expect(linkTitle('https://www.example.com/p/green-kettle')).toBe('green kettle (example.com)');
    expect(linkTitle('https://example.com/p/12345')).toBe('example.com');
  });
});

describe('an ISBN typed as an item', () => {
  it('is read when it is an ISBN and nothing else', () => {
    expect(typedIsbn('978-0-14-312779-6')).toBe('9780143127796');
    expect(typedIsbn('0143127799')).toBe('9780143127796');
  });

  it('is not read from a name with a number in it, or a bad check digit', () => {
    expect(typedIsbn('Catan 5th edition')).toBeNull();
    expect(typedIsbn('9780143127790')).toBeNull();
  });
});
