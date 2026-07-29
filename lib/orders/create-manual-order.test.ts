import { describe, expect, it } from 'vitest';
import { buildManualOrder } from './create-manual-order';

describe('buildManualOrder', () => {
  it('creates one inventory row per physical unit with allocateLandedCost cents', () => {
    const built = buildManualOrder({
      userId: 'user-1',
      merchantId: 'merchant-1',
      merchantSlug: 'nike',
      orderDate: '2026-03-15',
      taxCents: 3_600,
      shippingCents: 1_000,
      discountCents: 0,
      lines: [
        { name: 'Coat', quantity: 1, unitPriceCents: 40_000, categoryId: 'cat-1' },
        { name: 'Socks', quantity: 2, unitPriceCents: 600 },
      ],
    });

    expect(built.order.source).toBe('manual');
    expect(built.order.subtotalCents).toBe(41_200);
    expect(built.order.totalCents).toBe(45_800);
    expect(built.orderItems).toHaveLength(2);
    expect(built.inventoryItems).toHaveLength(3);

    const sum = built.inventoryItems.reduce((acc, row) => acc + row.costCents, 0);
    expect(sum).toBe(45_800);

    const coat = built.inventoryItems.find((row) => row.name === 'Coat')!;
    expect(coat.costCents).toBe(44_466);
    expect(coat.acquiredAt).toBe('2026-03-15');
    expect(coat.categoryId).toBe('cat-1');
    expect(coat.userId).toBe('user-1');
    expect(coat.shortName).toBe('Coat');
    expect(coat.searchTags).toContain('coat');
  });

  it('does not invent status fields', () => {
    const built = buildManualOrder({
      userId: 'user-1',
      merchantId: null,
      merchantSlug: null,
      orderDate: '2026-01-01',
      taxCents: 0,
      shippingCents: 0,
      discountCents: 0,
      lines: [{ name: 'Mug', quantity: 1, unitPriceCents: 1_200 }],
    });

    expect(built.order).not.toHaveProperty('status');
    expect(built.inventoryItems[0]).not.toHaveProperty('status');
  });

  it('rejects empty line lists and non-integer money', () => {
    expect(() =>
      buildManualOrder({
        userId: 'user-1',
        merchantId: null,
        merchantSlug: null,
        orderDate: '2026-01-01',
        taxCents: 0,
        shippingCents: 0,
        discountCents: 0,
        lines: [],
      }),
    ).toThrow(/at least one line/);

    expect(() =>
      buildManualOrder({
        userId: 'user-1',
        merchantId: null,
        merchantSlug: null,
        orderDate: '2026-01-01',
        taxCents: 1.5,
        shippingCents: 0,
        discountCents: 0,
        lines: [{ name: 'Mug', quantity: 1, unitPriceCents: 100 }],
      }),
    ).toThrow(/integer cents/);
  });
});
