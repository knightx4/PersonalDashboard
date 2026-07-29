import { describe, expect, it } from 'vitest';
import {
  allocateLandedCost,
  computeOrderTotalCents,
  formatCentsAsDollarsInput,
  formatPercentChange,
  formatReconciliation,
  parseDollarsToCents,
  percentChange,
  periodFor,
  previousPeriodFor,
  reconcilesToTotal,
  spend,
  spendByCategory,
  spendByMerchant,
  todayInTimezone,
  valueOwned,
  type OrderTotals,
} from './money';

describe('allocateLandedCost', () => {
  /**
   * The case that motivates proportional allocation. Split evenly, each of the
   * three units would carry $3.33 of shipping and the $6 socks would cost more
   * than half again their price.
   */
  const coatAndSocks = {
    lines: [
      { id: 'coat', quantity: 1, unitPriceCents: 40_000 },
      { id: 'socks', quantity: 2, unitPriceCents: 600 },
    ],
    totals: {
      subtotalCents: 41_200,
      taxCents: 3_600,
      shippingCents: 1_000,
      discountCents: 0,
      totalCents: 45_800,
    } satisfies OrderTotals,
  };

  it('allocates proportionally to line subtotal, not evenly across units', () => {
    const units = allocateLandedCost(coatAndSocks.lines, coatAndSocks.totals);

    expect(units).toHaveLength(3);
    const coat = units.find((u) => u.orderItemId === 'coat')!;
    const socks = units.filter((u) => u.orderItemId === 'socks');

    // 40000 + round(.970874 * 3600) + round(.970874 * 1000)
    expect(coat.costCents).toBe(44_466);
    // 600 + round(.014563 * 3600) + round(.014563 * 1000)
    expect(socks.map((s) => s.costCents)).toEqual([667, 667]);

    // An even split would have given each unit 1000/3 of shipping.
    const evenShipping = Math.round(1000 / 3);
    expect(socks[0].costCents - 600 - 52).not.toBe(evenShipping);
  });

  it('produces one row per physical unit', () => {
    const units = allocateLandedCost(
      [{ id: 'mug', quantity: 3, unitPriceCents: 1_000 }],
      {
        subtotalCents: 3_000,
        taxCents: 0,
        shippingCents: 0,
        discountCents: 0,
        totalCents: 3_000,
      },
    );
    expect(units.map((u) => u.unitIndex)).toEqual([0, 1, 2]);
  });

  it('sums exactly to the order total', () => {
    const units = allocateLandedCost(coatAndSocks.lines, coatAndSocks.totals);
    const sum = units.reduce((acc, u) => acc + u.costCents, 0);
    expect(sum).toBe(coatAndSocks.totals.totalCents);
  });

  it('assigns the rounding remainder to the highest-priced unit', () => {
    // Three odd-priced units against a tax that cannot divide cleanly.
    const lines = [
      { id: 'a', quantity: 1, unitPriceCents: 3_333 },
      { id: 'b', quantity: 1, unitPriceCents: 3_333 },
      { id: 'c', quantity: 1, unitPriceCents: 3_334 },
    ];
    const totals: OrderTotals = {
      subtotalCents: 10_000,
      taxCents: 877,
      shippingCents: 599,
      discountCents: 0,
      totalCents: 11_476,
    };

    const units = allocateLandedCost(lines, totals);
    expect(units.reduce((acc, u) => acc + u.costCents, 0)).toBe(totals.totalCents);

    // 'c' is the most expensive unit, so any remainder lands there
    const byId = Object.fromEntries(units.map((u) => [u.orderItemId, u.costCents]));
    expect(byId.a).toBe(byId.b);
    expect(byId.c).toBeGreaterThanOrEqual(byId.a);
  });

  it('sums exactly to the total across many randomised orders', () => {
    // The invariant the whole inventory and category surface depends on.
    let seed = 42;
    const rand = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % max;
    };

    for (let trial = 0; trial < 500; trial++) {
      const lineCount = 1 + rand(5);
      const lines = Array.from({ length: lineCount }, (_, i) => ({
        id: `line-${i}`,
        quantity: 1 + rand(4),
        unitPriceCents: 1 + rand(50_000),
      }));
      const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0);
      const tax = rand(Math.max(1, Math.round(subtotal * 0.12)));
      const shipping = rand(2_500);
      const discount = rand(Math.max(1, Math.round(subtotal * 0.3)));
      const totals: OrderTotals = {
        subtotalCents: subtotal,
        taxCents: tax,
        shippingCents: shipping,
        discountCents: discount,
        totalCents: subtotal + tax + shipping - discount,
      };

      const units = allocateLandedCost(lines, totals);
      const sum = units.reduce((acc, u) => acc + u.costCents, 0);
      expect(sum, `trial ${trial} did not sum to total`).toBe(totals.totalCents);
    }
  });

  it('falls back to an even split when the subtotal is zero', () => {
    const units = allocateLandedCost(
      [{ id: 'free', quantity: 2, unitPriceCents: 0 }],
      {
        subtotalCents: 0,
        taxCents: 0,
        shippingCents: 500,
        discountCents: 0,
        totalCents: 500,
      },
    );
    expect(units.map((u) => u.costCents)).toEqual([250, 250]);
  });

  it('rejects non-integer cents rather than silently accumulating float error', () => {
    expect(() =>
      allocateLandedCost([{ id: 'x', quantity: 1, unitPriceCents: 10.5 }], {
        subtotalCents: 10.5,
        taxCents: 0,
        shippingCents: 0,
        discountCents: 0,
        totalCents: 10.5,
      }),
    ).toThrow(/integer cents/);
  });
});

describe('reconcilesToTotal', () => {
  it('accepts an order whose lines add up', () => {
    expect(
      reconcilesToTotal(
        [
          { id: 'a', quantity: 2, unitPriceCents: 1_000 },
          { id: 'b', quantity: 1, unitPriceCents: 500 },
        ],
        {
          subtotalCents: 2_500,
          taxCents: 200,
          shippingCents: 300,
          discountCents: 100,
          totalCents: 2_900,
        },
      ),
    ).toBe(true);
  });

  it('rejects an extraction that dropped a line item', () => {
    // The coat survived, the socks did not. This is the failure mode the gate
    // exists to catch, and no confidence score should override it.
    expect(
      reconcilesToTotal([{ id: 'coat', quantity: 1, unitPriceCents: 40_000 }], {
        subtotalCents: 41_200,
        taxCents: 3_600,
        shippingCents: 1_000,
        discountCents: 0,
        totalCents: 45_800,
      }),
    ).toBe(false);
  });

  it('tolerates a couple of cents of rounding', () => {
    expect(
      reconcilesToTotal([{ id: 'a', quantity: 3, unitPriceCents: 333 }], {
        subtotalCents: 999,
        taxCents: 0,
        shippingCents: 0,
        discountCents: 0,
        totalCents: 1_000,
      }),
    ).toBe(true);
  });
});

/**
 * The fixture named in the MVP acceptance criteria: an order in January,
 * partially returned in March, with shipping not refunded. Both months must
 * match hand-computed totals.
 *
 * By hand:
 *   January order  $458.00 total ($412.00 subtotal + $36.00 tax + $10.00 ship)
 *   March order    $50.00
 *   March refund   the $400 coat plus its $34.95 share of tax = $434.95.
 *                  Its $9.71 share of shipping is withheld by the merchant.
 *
 *   January net = $458.00            (unchanged by the March refund)
 *   March net   = $50.00 - $434.95 = -$384.95
 */
describe('spend -- January order, March partial return, shipping withheld', () => {
  const orders = [
    { orderDate: '2026-01-15', totalCents: 45_800, cancelled: false },
    { orderDate: '2026-03-04', totalCents: 5_000, cancelled: false },
    { orderDate: '2026-01-20', totalCents: 9_900, cancelled: true },
  ];

  const refunds = [
    { refundedAt: '2026-03-10', refundAmountCents: 43_495, refunded: true },
    // initiated but not yet refunded: must not count anywhere
    { refundedAt: null, refundAmountCents: 667, refunded: false },
  ];

  const january = { start: '2026-01-01', end: '2026-01-31' };
  const march = { start: '2026-03-01', end: '2026-03-31' };

  it('reports January gross excluding the cancelled order', () => {
    expect(spend(orders, refunds, january).grossCents).toBe(45_800);
  });

  it('does not let the March refund rewrite January', () => {
    const jan = spend(orders, refunds, january);
    expect(jan.refundedCents).toBe(0);
    expect(jan.netCents).toBe(45_800);
  });

  it('subtracts the refund in the month it was received', () => {
    const mar = spend(orders, refunds, march);
    expect(mar.grossCents).toBe(5_000);
    expect(mar.refundedCents).toBe(43_495);
    expect(mar.netCents).toBe(-38_495);
  });

  it('subtracts what was actually refunded, not the sticker price', () => {
    // The coat's landed cost was $444.66; the merchant kept the $9.71 shipping
    // share, so recovery is $434.95. Using the landed cost would overstate it.
    const coatLandedCost = 44_466;
    expect(spend(orders, refunds, march).refundedCents).toBeLessThan(coatLandedCost);
    expect(spend(orders, refunds, march).refundedCents).toBe(43_495);
  });

  it('ignores refunds that have only been initiated', () => {
    const all = { start: '2026-01-01', end: '2026-12-31' };
    expect(spend(orders, refunds, all).refundedCents).toBe(43_495);
  });

  it('renders the reconciliation line under the headline number', () => {
    expect(formatReconciliation(spend(orders, refunds, march))).toBe(
      '$50.00 gross, less $434.95 refunded',
    );
    expect(formatReconciliation(spend(orders, refunds, january))).toBe('$458.00 gross');
  });
});

describe('valueOwned', () => {
  it('counts only items still owned, and is a different base from spend', () => {
    const items = [
      { costCents: 44_466, status: 'returned' },
      { costCents: 667, status: 'owned' },
      { costCents: 667, status: 'owned' },
      { costCents: 5_000, status: 'disposed' },
    ];
    expect(valueOwned(items)).toBe(1_334);
  });
});

describe('period boundaries', () => {
  it('uses the user timezone, not the server', () => {
    // 2026-03-01 09:00 UTC is already the 1st in Auckland (22:00 on the 1st)
    // and still the 28th of February in Honolulu.
    const instant = new Date('2026-03-01T09:00:00Z');
    expect(todayInTimezone('Pacific/Auckland', instant)).toBe('2026-03-01');
    expect(todayInTimezone('Pacific/Honolulu', instant)).toBe('2026-02-28');

    expect(periodFor('this_month', 'Pacific/Auckland', instant).start).toBe('2026-03-01');
    expect(periodFor('this_month', 'Pacific/Honolulu', instant).start).toBe('2026-02-01');
  });

  it('computes each preset range', () => {
    const now = new Date('2026-07-15T12:00:00Z');
    expect(periodFor('this_month', 'UTC', now)).toEqual({
      start: '2026-07-01',
      end: '2026-07-31',
    });
    expect(periodFor('last_month', 'UTC', now)).toEqual({
      start: '2026-06-01',
      end: '2026-06-30',
    });
    expect(periodFor('last_3_months', 'UTC', now)).toEqual({
      start: '2026-05-01',
      end: '2026-07-15',
    });
    expect(periodFor('ytd', 'UTC', now)).toEqual({ start: '2026-01-01', end: '2026-07-15' });
    expect(periodFor('last_12_months', 'UTC', now)).toEqual({
      start: '2025-08-01',
      end: '2026-07-15',
    });
  });

  it('handles the January rollover for last_month', () => {
    const now = new Date('2026-01-09T12:00:00Z');
    expect(periodFor('last_month', 'UTC', now)).toEqual({
      start: '2025-12-01',
      end: '2025-12-31',
    });
  });

  it('handles February in a leap year', () => {
    const now = new Date('2028-02-10T12:00:00Z');
    expect(periodFor('this_month', 'UTC', now).end).toBe('2028-02-29');
  });

  it('computes the comparable previous window for each preset', () => {
    const now = new Date('2026-07-15T12:00:00Z');
    expect(previousPeriodFor('this_month', 'UTC', now)).toEqual({
      start: '2026-06-01',
      end: '2026-06-30',
    });
    expect(previousPeriodFor('last_month', 'UTC', now)).toEqual({
      start: '2026-05-01',
      end: '2026-05-31',
    });
    expect(previousPeriodFor('last_3_months', 'UTC', now)).toEqual({
      start: '2026-02-01',
      end: '2026-04-30',
    });
    expect(previousPeriodFor('ytd', 'UTC', now)).toEqual({
      start: '2025-01-01',
      end: '2025-07-15',
    });
    expect(previousPeriodFor('last_12_months', 'UTC', now)).toEqual({
      start: '2024-08-01',
      end: '2025-07-15',
    });
  });
});

describe('percentChange', () => {
  it('returns null when the baseline is zero', () => {
    expect(percentChange(100, 0)).toBeNull();
    expect(formatPercentChange(null)).toBeNull();
  });

  it('formats signed whole percentages with a proper minus', () => {
    expect(formatPercentChange(percentChange(120, 100))).toBe('+20%');
    expect(formatPercentChange(percentChange(80, 100))).toBe('−20%');
    expect(formatPercentChange(percentChange(100, 100))).toBe('0%');
  });
});

describe('spendByCategory / spendByMerchant', () => {
  it('groups landed costs by category for orders in the period', () => {
    const slices = spendByCategory(
      [
        {
          orderDate: '2026-07-02',
          cancelled: false,
          costCents: 4_000,
          categoryId: 'clothing',
          categoryName: 'Clothing',
          categoryColor: '#6A82FB',
        },
        {
          orderDate: '2026-07-03',
          cancelled: false,
          costCents: 2_000,
          categoryId: 'clothing',
          categoryName: 'Clothing',
          categoryColor: '#6A82FB',
        },
        {
          orderDate: '2026-07-04',
          cancelled: false,
          costCents: 1_500,
          categoryId: null,
          categoryName: null,
          categoryColor: null,
        },
        {
          orderDate: '2026-06-01',
          cancelled: false,
          costCents: 9_999,
          categoryId: 'home',
          categoryName: 'Home',
          categoryColor: '#FF8A4C',
        },
        {
          orderDate: '2026-07-05',
          cancelled: true,
          costCents: 500,
          categoryId: 'clothing',
          categoryName: 'Clothing',
          categoryColor: '#6A82FB',
        },
      ],
      { start: '2026-07-01', end: '2026-07-31' },
    );

    expect(slices).toEqual([
      {
        categoryId: 'clothing',
        name: 'Clothing',
        color: '#6A82FB',
        cents: 6_000,
      },
      {
        categoryId: null,
        name: 'Uncategorized',
        color: '#9a9a94',
        cents: 1_500,
      },
    ]);
  });

  it('groups gross order totals by merchant', () => {
    const slices = spendByMerchant(
      [
        {
          orderDate: '2026-07-02',
          totalCents: 5_000,
          cancelled: false,
          merchantId: 'nike',
          merchantName: 'Nike',
        },
        {
          orderDate: '2026-07-10',
          totalCents: 3_000,
          cancelled: false,
          merchantId: 'nike',
          merchantName: 'Nike',
        },
        {
          orderDate: '2026-07-12',
          totalCents: 8_000,
          cancelled: false,
          merchantId: 'amazon',
          merchantName: 'Amazon',
        },
        {
          orderDate: '2026-07-15',
          totalCents: 1_000,
          cancelled: true,
          merchantId: 'amazon',
          merchantName: 'Amazon',
        },
      ],
      { start: '2026-07-01', end: '2026-07-31' },
    );

    expect(slices).toEqual([
      { merchantId: 'amazon', name: 'Amazon', cents: 8_000 },
      { merchantId: 'nike', name: 'Nike', cents: 8_000 },
    ]);
  });
});

describe('parseDollarsToCents', () => {
  it('parses common form inputs without floats', () => {
    expect(parseDollarsToCents('')).toBe(0);
    expect(parseDollarsToCents('12')).toBe(1_200);
    expect(parseDollarsToCents('12.3')).toBe(1_230);
    expect(parseDollarsToCents('12.99')).toBe(1_299);
    expect(parseDollarsToCents('$1,299.00')).toBe(129_900);
    expect(parseDollarsToCents('-4.50')).toBe(-450);
  });

  it('rejects more than two decimal places', () => {
    expect(() => parseDollarsToCents('1.234')).toThrow(/dollar amount/);
  });

  it('round-trips with formatCentsAsDollarsInput', () => {
    expect(formatCentsAsDollarsInput(1_299)).toBe('12.99');
    expect(parseDollarsToCents(formatCentsAsDollarsInput(45_800))).toBe(45_800);
  });

  it('computes order totals as integer cents', () => {
    expect(
      computeOrderTotalCents({
        subtotalCents: 10_000,
        taxCents: 800,
        shippingCents: 500,
        discountCents: 200,
      }),
    ).toBe(11_100);
  });
});
