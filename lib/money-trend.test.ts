import { describe, expect, it } from 'vitest';
import { monthlySpendByMerchant, recentMonthKeys, type MerchantSpendOrder } from './money';

const order = (
  orderDate: string,
  totalCents: number,
  merchantId: string | null = 'm1',
  cancelled = false,
): MerchantSpendOrder => ({
  orderDate,
  totalCents,
  cancelled,
  merchantId,
  merchantName: 'Amazon',
});

describe('recentMonthKeys', () => {
  it('ends on the month the date falls in', () => {
    expect(recentMonthKeys('2026-03-14', 3)).toEqual(['2026-01', '2026-02', '2026-03']);
  });

  it('walks back across a year boundary', () => {
    expect(recentMonthKeys('2026-02-01', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('handles a January start without landing on month zero', () => {
    expect(recentMonthKeys('2026-01-31', 2)).toEqual(['2025-12', '2026-01']);
  });
});

describe('monthlySpendByMerchant', () => {
  it('keeps every month in the window, including the empty ones', () => {
    const series = monthlySpendByMerchant([order('2026-03-02', 1000)], '2026-03-14', 3);
    expect(series.get('m1')).toEqual([
      { month: '2026-01', cents: 0 },
      { month: '2026-02', cents: 0 },
      { month: '2026-03', cents: 1000 },
    ]);
  });

  it('sums within a month and separates merchants', () => {
    const series = monthlySpendByMerchant(
      [order('2026-03-02', 1000), order('2026-03-20', 500), order('2026-03-04', 700, 'm2')],
      '2026-03-14',
      1,
    );
    expect(series.get('m1')).toEqual([{ month: '2026-03', cents: 1500 }]);
    expect(series.get('m2')).toEqual([{ month: '2026-03', cents: 700 }]);
  });

  it('ignores cancelled orders and anything outside the window', () => {
    const series = monthlySpendByMerchant(
      [order('2026-03-02', 1000, 'm1', true), order('2024-01-02', 900)],
      '2026-03-14',
      2,
    );
    expect(series.size).toBe(0);
  });

  it('groups orders with no merchant under one key', () => {
    const series = monthlySpendByMerchant(
      [order('2026-03-02', 1000, null), order('2026-03-09', 200, null)],
      '2026-03-14',
      1,
    );
    expect(series.get('__unknown__')).toEqual([{ month: '2026-03', cents: 1200 }]);
  });
});
