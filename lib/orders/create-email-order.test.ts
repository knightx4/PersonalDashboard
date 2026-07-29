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
    expect(bundle.inventoryItems.reduce((s, i) => s + i.costCents, 0)).toBe(2100);
  });
});
