import { describe, expect, it } from 'vitest';
import { formatRange, parsePriceEvidence, priceStats } from './price-evidence';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

describe('priceStats', () => {
  it('reports the order statistics the panel shows', () => {
    expect(priceStats([3000, 1000, 5000, 2000, 4000])).toEqual({
      count: 5,
      minCents: 1000,
      p25Cents: 2000,
      medianCents: 3000,
      maxCents: 5000,
    });
  });

  it('lands on the cheapest ask when the market is thin', () => {
    // Four listings put p25 on index 0 -- the quirk the range exists to expose.
    const stats = priceStats([1000, 2000, 3000, 4000])!;
    expect(stats.p25Cents).toBe(1000);
    expect(stats.minCents).toBe(1000);
    expect(stats.maxCents).toBe(4000);
  });

  it('handles a single listing and an empty market', () => {
    expect(priceStats([1500])).toEqual({
      count: 1,
      minCents: 1500,
      p25Cents: 1500,
      medianCents: 1500,
      maxCents: 1500,
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
