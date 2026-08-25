import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EFFORT_CENTS,
  DEFAULT_NET_FLOOR_CENTS,
  MEDIA_MAIL_1LB_CENTS,
  defaultNetFloorCents,
  ebayFinalValueFeeCents,
  ebayPerOrderFeeCents,
  netBuyback,
  netSelf,
} from './pricing';

describe('ebay fees', () => {
  it('charges 15.3% on books totals under the breakpoint', () => {
    // $25 item + $4.39 shipping = 2939 → 15.3% ≈ 450
    expect(ebayFinalValueFeeCents(2500 + MEDIA_MAIL_1LB_CENTS)).toBe(
      Math.round((2500 + MEDIA_MAIL_1LB_CENTS) * 0.153),
    );
  });

  it('uses $0.30 / $0.40 per-order fee around $10', () => {
    expect(ebayPerOrderFeeCents(1000)).toBe(30);
    expect(ebayPerOrderFeeCents(1001)).toBe(40);
  });
});

describe('netSelf', () => {
  it('subtracts FVF, per-order, shipping, and effort', () => {
    const result = netSelf({ expectedPriceCents: 2500 });
    expect(result.shippingCents).toBe(MEDIA_MAIL_1LB_CENTS);
    expect(result.effortCents).toBe(DEFAULT_EFFORT_CENTS);
    expect(result.netCents).toBe(
      2500 - result.fvfCents - result.perOrderFeeCents - MEDIA_MAIL_1LB_CENTS - DEFAULT_EFFORT_CENTS,
    );
  });
});

describe('netBuyback', () => {
  it('defaults shipping to zero', () => {
    expect(netBuyback({ quoteCents: 800 })).toEqual({
      quoteCents: 800,
      shippingCents: 0,
      netCents: 800,
    });
  });
});

describe('defaultNetFloorCents', () => {
  it('falls back when the sample is small', () => {
    expect(defaultNetFloorCents([100, 200])).toBe(DEFAULT_NET_FLOOR_CENTS);
  });

  it('uses a low percentile for larger libraries', () => {
    const values = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    const floor = defaultNetFloorCents(values);
    expect(floor).toBeGreaterThanOrEqual(100);
    expect(floor).toBeLessThanOrEqual(500);
  });
});
