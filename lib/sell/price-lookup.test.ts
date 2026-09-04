/**
 * The point of this module is that every caller asks the same way, so the
 * tests are about the contract: evidence when the source has it, the number
 * when it does not, and never both calls for one lookup.
 */
import { describe, expect, it, vi } from 'vitest';
import { lookupPriceByIsbn, lookupPriceBySubject } from './price-lookup';
import type { ExpectedPriceSource } from './expected-price';
import type { PriceEvidence } from './price-evidence';

const evidence: PriceEvidence = {
  source: 'ebay_browse',
  typicalCents: 1200,
  lowCents: 800,
  highCents: 9000,
  medianCents: 1500,
  sampleSize: 3,
  totalMatches: 42,
  listings: [
    { title: 'A copy', url: 'https://ebay.com/itm/1', priceCents: 800, shippingCents: 0, condition: 'Good' },
  ],
  note: null,
  query: '9780735211292',
  fetchedAt: '2026-09-04T00:00:00.000Z',
};

function richSource() {
  return {
    expectedSelfListCents: vi.fn(async () => 999),
    expectedSelfListCentsFor: vi.fn(async () => 999),
    priceEvidenceForIsbn: vi.fn(async () => evidence),
    priceEvidence: vi.fn(async () => evidence),
  } satisfies ExpectedPriceSource;
}

/** A source from before evidence existed — the Null and Fixture ones. */
function plainSource() {
  return {
    expectedSelfListCents: vi.fn(async () => 1500),
    expectedSelfListCentsFor: vi.fn(async () => 1600),
  } satisfies ExpectedPriceSource;
}

describe('lookupPriceByIsbn', () => {
  it('takes the router number from the evidence, and asks only once', async () => {
    const source = richSource();
    const result = await lookupPriceByIsbn(source, '9780735211292');

    expect(result.cents).toBe(1200);
    expect(result.evidence?.listings).toHaveLength(1);
    // Billed per lookup: the number method must not also run.
    expect(source.expectedSelfListCents).not.toHaveBeenCalled();
    expect(source.priceEvidenceForIsbn).toHaveBeenCalledTimes(1);
  });

  it('falls back to the number for a source without evidence', async () => {
    const source = plainSource();
    expect(await lookupPriceByIsbn(source, '9780735211292')).toEqual({
      cents: 1500,
      evidence: null,
    });
  });

  it('reports no price when the evidence lookup finds nothing', async () => {
    const source = { ...richSource(), priceEvidenceForIsbn: vi.fn(async () => null) };
    expect(await lookupPriceByIsbn(source, '9780735211292')).toEqual({
      cents: null,
      evidence: null,
    });
    // Crucially it does not retry through the number path, which would bill twice.
    expect(source.expectedSelfListCents).not.toHaveBeenCalled();
  });
});

describe('lookupPriceBySubject', () => {
  it('passes the subject through and returns the evidence', async () => {
    const source = richSource();
    const subject = { query: 'Acquire 1963 board game', hint: 'Board game' };
    const result = await lookupPriceBySubject(source, subject);

    expect(result.cents).toBe(1200);
    expect(source.priceEvidence).toHaveBeenCalledWith(subject);
    expect(source.expectedSelfListCentsFor).not.toHaveBeenCalled();
  });

  it('falls back to the number for a source without evidence', async () => {
    expect(await lookupPriceBySubject(plainSource(), { query: 'x' })).toEqual({
      cents: 1600,
      evidence: null,
    });
  });
});
