import { describe, expect, it } from 'vitest';
import { guessCategorySlug } from './guess-category';
import { normalizeCategorySlug, restrictCategorySlugs } from './schema';
import { slugifyCategoryName } from '@/lib/categories/slugify';

describe('custom category helpers', () => {
  it('slugifies category names', () => {
    expect(slugifyCategoryName('Camping Gear')).toBe('camping-gear');
    expect(slugifyCategoryName('  Kids’ Toys ')).toBe('kids-toys');
  });

  it('normalizes model category slugs', () => {
    expect(normalizeCategorySlug('Camping Gear')).toBe('camping-gear');
    expect(normalizeCategorySlug('books')).toBe('books');
    expect(normalizeCategorySlug('!!!')).toBeNull();
  });

  it('prefers matching custom categories in heuristic guesses', () => {
    expect(
      guessCategorySlug({
        name: 'REI Trail Camping Tent',
        customCategories: [{ slug: 'camping', name: 'Camping' }],
      }),
    ).toBe('camping');
  });

  it('restricts extracted slugs to the allowed set', () => {
    const order = restrictCategorySlugs(
      {
        orderDate: '2026-01-01',
        currency: 'USD',
        taxCents: 0,
        shippingCents: 0,
        discountCents: 0,
        totalCents: 100,
        lines: [
          { name: 'Tent', quantity: 1, unitPriceCents: 100, categorySlug: 'camping' },
          { name: 'Widget', quantity: 1, unitPriceCents: 0, categorySlug: 'made-up' },
        ],
      },
      new Set(['camping', 'other']),
    );
    expect(order.lines[0]?.categorySlug).toBe('camping');
    expect(order.lines[1]?.categorySlug).toBe('other');
  });
});
