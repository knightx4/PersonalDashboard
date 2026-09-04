import { describe, expect, it } from 'vitest';
import { formatRange, parsePriceEvidence, priceStats } from './price-evidence';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

describe('priceStats', () => {
  /** Twenty listings, $5 to $100 in $5 steps. A market with a shape. */
  const healthy = Array.from({ length: 20 }, (_, i) => (i + 1) * 500);

  it('takes the 40th percentile of a healthy market', () => {
    const stats = priceStats(healthy)!;
    expect(stats.count).toBe(20);
    // floor(19 * 0.4) = 7, so the eighth cheapest of twenty.
    expect(stats.typicalCents).toBe(4000);
    expect(stats.typicalBasis).toBe('percentile');
    // Below the middle, because asks run high -- but not near the bottom.
    expect(stats.typicalCents).toBeLessThan(stats.medianCents);
    expect(stats.typicalCents).toBeGreaterThan(stats.minCents);
  });

  it('uses the median once the market is too thin to have a shape', () => {
    // Three listings, one of them a lowball. The percentile would land on it.
    const thin = priceStats([200, 3000, 3400])!;
    expect(thin.typicalBasis).toBe('median');
    expect(thin.typicalCents).toBe(3000);
    expect(thin.typicalCents).not.toBe(thin.minCents);
  });

  it('switches rules at five listings', () => {
    expect(priceStats([100, 200, 300, 400])!.typicalBasis).toBe('median');
    expect(priceStats([100, 200, 300, 400, 500])!.typicalBasis).toBe('percentile');
  });

  it('survives a single listing and an empty market', () => {
    const one = priceStats([1500])!;
    expect(one).toMatchObject({
      count: 1,
      minCents: 1500,
      typicalCents: 1500,
      medianCents: 1500,
      maxCents: 1500,
      typicalBasis: 'median',
    });
    expect(priceStats([])).toBeNull();
  });

  it('does not mutate what it is given', () => {
    const input = [3000, 1000, 2000];
    priceStats(input);
    expect(input).toEqual([3000, 1000, 2000]);
  });
});

describe('formatRange', () => {
  it('collapses a range with no spread to one price', () => {
    expect(formatRange(1500, 1500, money)).toBe('$15.00');
    expect(formatRange(1000, 4000, money)).toBe('$10.00–$40.00');
    expect(formatRange(null, 4000, money)).toBeNull();
    expect(formatRange(1000, null, money)).toBeNull();
  });
});

describe('parsePriceEvidence', () => {
  it('reads back what the runner stored', () => {
    const stored = {
      source: 'ebay_browse',
      typicalCents: 1200,
      lowCents: 800,
      highCents: 3400,
      medianCents: 1500,
      sampleSize: 12,
      totalMatches: 340,
      listings: [
        { title: 'A book', url: 'https://ebay.com/itm/1', priceCents: 800, shippingCents: 0, condition: 'Used' },
      ],
      note: null,
      query: '9780735211292',
      fetchedAt: '2026-09-04T00:00:00.000Z',
    };
    expect(parsePriceEvidence(stored)?.listings[0]?.priceCents).toBe(800);
    expect(parsePriceEvidence(stored)?.totalMatches).toBe(340);
  });

  it('fills in the optional fields a web estimate leaves out', () => {
    const parsed = parsePriceEvidence({
      source: 'web_estimate',
      typicalCents: 1200,
      fetchedAt: '2026-09-04T00:00:00.000Z',
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.listings).toEqual([]);
    expect(parsed?.sampleSize).toBeNull();
  });

  it('returns null for anything it does not recognise, rather than throwing', () => {
    // An older deploy's payload must not be able to break the item page.
    expect(parsePriceEvidence(null)).toBeNull();
    expect(parsePriceEvidence('nonsense')).toBeNull();
    expect(parsePriceEvidence({ source: 'ebay_browse' })).toBeNull();
    expect(parsePriceEvidence({ source: 'carrier_pigeon', typicalCents: 1, fetchedAt: 'x' })).toBeNull();
  });
});
