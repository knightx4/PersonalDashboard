import { describe, expect, it } from 'vitest';
import { buildOwnedBookRows } from './create-owned-book';
import type { CanonicalBook } from './types';

const sample: CanonicalBook = {
  isbn13: '9780735211292',
  isbn10: '0735211299',
  title: 'Atomic Habits',
  authors: ['James Clear'],
  publisher: 'Avery',
  publishedYear: 2018,
  edition: null,
  coverUrl: 'https://example.com/cover.jpg',
  weightGrams: null,
  matchConfidence: 0.98,
  needsConfirmation: false,
  resolutionSource: 'google_books',
};

describe('buildOwnedBookRows', () => {
  it('builds standalone inventory + book_details without an order', () => {
    const bundle = buildOwnedBookRows({
      userId: '11111111-1111-1111-1111-111111111111',
      booksCategoryId: '22222222-2222-2222-2222-222222222222',
      book: sample,
      acquiredAt: '2026-08-25',
    });

    expect(bundle.inventory.orderItemId).toBeNull();
    expect(bundle.inventory.costCents).toBe(0);
    expect(bundle.inventory.source).toBe('manual');
    expect(bundle.inventory.name).toBe('Atomic Habits');
    expect(bundle.bookDetails.isbn13).toBe('9780735211292');
    expect(bundle.bookDetails.needsConfirmation).toBe(false);
    expect(bundle.bookDetails.inventoryItemId).toBe(bundle.inventory.id);
  });

  it('preserves needsConfirmation for ambiguous title matches', () => {
    const bundle = buildOwnedBookRows({
      userId: '11111111-1111-1111-1111-111111111111',
      booksCategoryId: '22222222-2222-2222-2222-222222222222',
      book: { ...sample, needsConfirmation: true, matchConfidence: 0.5 },
      acquiredAt: '2026-08-25',
    });
    expect(bundle.bookDetails.needsConfirmation).toBe(true);
  });

  it('forceConfirmed clears the flag', () => {
    const bundle = buildOwnedBookRows({
      userId: '11111111-1111-1111-1111-111111111111',
      booksCategoryId: '22222222-2222-2222-2222-222222222222',
      book: { ...sample, needsConfirmation: true },
      acquiredAt: '2026-08-25',
      forceConfirmed: true,
    });
    expect(bundle.bookDetails.needsConfirmation).toBe(false);
  });
});
