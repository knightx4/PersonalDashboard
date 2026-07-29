import { describe, expect, it } from 'vitest';
import { buildEmailOrder } from './create-email-order';

describe('buildEmailOrder', () => {
  it('creates one inventory row per unit with email source', () => {
    const bundle = buildEmailOrder({
      userId: '00000000-0000-4000-8000-000000000001',
      merchantId: null,
      merchantSlug: 'amazon',
      categoryIdsBySlug: new Map([['books', 'cat-books']]),
      extraction: {
        orderDate: '2026-01-15',
        currency: 'USD',
        taxCents: 100,
        shippingCents: 0,
        discountCents: 0,
        totalCents: 2100,
        lines: [
          {
            name: 'Widget',
            quantity: 2,
            unitPriceCents: 1000,
            variant: null,
            categorySlug: 'books',
            productUrl: 'https://www.amazon.com/dp/0062234730',
          },
        ],
        externalOrderNumber: 'ABC',
      },
    });
    expect(bundle.order.source).toBe('email');
    expect(bundle.orderItems).toHaveLength(1);
    expect(bundle.orderItems[0]?.categoryId).toBe('cat-books');
    expect(bundle.orderItems[0]?.productUrl).toBe('https://www.amazon.com/dp/0062234730');
    expect(bundle.inventoryItems).toHaveLength(2);
    expect(bundle.inventoryItems[0]?.categoryId).toBe('cat-books');
    expect(bundle.inventoryItems[0]?.shortName).toBeTruthy();
    expect(bundle.inventoryItems[0]?.searchTags.length).toBeGreaterThan(0);
    expect(bundle.inventoryItems.reduce((s, i) => s + i.costCents, 0)).toBe(2100);
  });

  it('creates separate order items and inventory rows for multi-item orders', () => {
    const bundle = buildEmailOrder({
      userId: '00000000-0000-4000-8000-000000000001',
      merchantId: null,
      merchantSlug: 'amazon',
      categoryIdsBySlug: new Map([['clothing', 'cat-clothing']]),
      extraction: {
        orderDate: '2026-03-30',
        currency: 'USD',
        taxCents: 298,
        shippingCents: 0,
        discountCents: 0,
        totalCents: 4996,
        lines: [
          {
            name: 'Legacy NCAA Baseball Hat',
            quantity: 1,
            unitPriceCents: 2699,
            variant: null,
            categorySlug: 'clothing',
            productUrl: 'https://www.amazon.com/dp/B0DY913JWM',
          },
          {
            name: 'NYU T Shirt',
            quantity: 1,
            unitPriceCents: 1999,
            variant: 'Small',
            categorySlug: 'clothing',
            productUrl: 'https://www.amazon.com/dp/B09Z6YCQQR',
          },
        ],
        externalOrderNumber: '114-9014714-4960229',
      },
    });
    expect(bundle.orderItems).toHaveLength(2);
    expect(bundle.inventoryItems).toHaveLength(2);
    expect(bundle.inventoryItems.map((i) => i.name)).toEqual([
      'Legacy NCAA Baseball Hat',
      'NYU T Shirt',
    ]);
    expect(bundle.inventoryItems.reduce((s, i) => s + i.costCents, 0)).toBe(4996);
  });
});
