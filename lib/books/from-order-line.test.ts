import { describe, expect, it } from 'vitest';
import {
  bookHintFromOrderLine,
  cleanBookTitle,
  isbnFromProductUrl,
  looksLikeBookLine,
} from '@/lib/books/from-order-line';

describe('isbnFromProductUrl', () => {
  it('reads a book ASIN as an ISBN-10', () => {
    expect(isbnFromProductUrl('https://www.amazon.com/dp/0735211299')).toBe(
      '9780735211292',
    );
    expect(isbnFromProductUrl('https://www.amazon.com/gp/product/0735211299?ref=x')).toBe(
      '9780735211292',
    );
  });

  it('ignores non-book ASINs and other retailers', () => {
    expect(isbnFromProductUrl('https://www.amazon.com/dp/B08N5WRWNW')).toBeNull();
    expect(isbnFromProductUrl('https://shop.example.com/products/mug')).toBeNull();
    expect(isbnFromProductUrl(null)).toBeNull();
  });
});

describe('looksLikeBookLine', () => {
  it('trusts the category, tags, or wording', () => {
    expect(looksLikeBookLine({ name: 'Dune', categorySlug: 'books' })).toBe(true);
    expect(looksLikeBookLine({ name: 'Dune', searchTags: ['book'] })).toBe(true);
    expect(looksLikeBookLine({ name: 'Dune (Paperback)' })).toBe(true);
    expect(looksLikeBookLine({ name: 'Anker USB-C cable' })).toBe(false);
  });
});

describe('cleanBookTitle', () => {
  it('splits a trailing author and drops the binding', () => {
    expect(cleanBookTitle('Atomic Habits by James Clear')).toEqual({
      title: 'Atomic Habits',
      author: 'James Clear',
    });
    expect(cleanBookTitle('Dune (Paperback)')).toEqual({ title: 'Dune', author: null });
    expect(cleanBookTitle('Dune (Paperback) - Reprint Edition')).toEqual({
      title: 'Dune',
      author: null,
    });
  });
});

describe('bookHintFromOrderLine', () => {
  it('prefers the ISBN from an Amazon product link', () => {
    expect(
      bookHintFromOrderLine({
        name: 'Atomic Habits: An Easy & Proven Way to Build Good Habits',
        productUrl: 'https://www.amazon.com/dp/0735211299',
        categorySlug: 'books',
      }),
    ).toMatchObject({ kind: 'isbn', isbn13: '9780735211292' });
  });

  it('falls back to a cleaned title for book lines with no ISBN', () => {
    expect(
      bookHintFromOrderLine({ name: 'Dune by Frank Herbert', categorySlug: 'books' }),
    ).toEqual({ kind: 'title', title: 'Dune', author: 'Frank Herbert' });
  });

  it('leaves non-book lines alone', () => {
    expect(
      bookHintFromOrderLine({
        name: 'Anker 6ft USB-C Cable',
        productUrl: 'https://www.amazon.com/dp/B08N5WRWNW',
        categorySlug: 'electronics',
      }),
    ).toBeNull();
  });

  it('skips formats that cannot be resold as a physical unit', () => {
    expect(
      bookHintFromOrderLine({
        name: 'Dune (Kindle Edition)',
        categorySlug: 'books',
      }),
    ).toBeNull();
  });

  it('does not read stray digits in a non-book title as an ISBN', () => {
    expect(
      bookHintFromOrderLine({
        name: 'Logitech MX Master 3S 0735211299',
        categorySlug: 'electronics',
      }),
    ).toBeNull();
  });
});
