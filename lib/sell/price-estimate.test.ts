import { describe, expect, it } from 'vitest';
import { parseEstimatePayload } from '@/lib/sell/price-estimate';

const good = {
  low_cents: 500,
  typical_cents: 900,
  high_cents: 1800,
  currency: 'USD',
  confidence: 'medium',
  basis: 'Three completed eBay sales in the last month.',
  sources: [{ title: 'eBay sold', url: 'https://example.com/sold' }],
};

describe('parseEstimatePayload', () => {
  it('accepts a coherent estimate', () => {
    const result = parseEstimatePayload(good);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.estimate.typical_cents).toBe(900);
  });

  it('treats an explicit no_data as no price rather than zero', () => {
    const result = parseEstimatePayload({ ...good, no_data: true });
    expect(result.ok).toBe(false);
  });

  it('rejects a zero typical price', () => {
    const result = parseEstimatePayload({ ...good, typical_cents: 0 });
    expect(result.ok).toBe(false);
  });

  it('rejects a range that does not contain its own typical value', () => {
    // A model that guesses tends to produce exactly this shape.
    expect(parseEstimatePayload({ ...good, typical_cents: 4000 }).ok).toBe(false);
    expect(parseEstimatePayload({ ...good, low_cents: 2000 }).ok).toBe(false);
  });

  it('rejects a malformed payload', () => {
    expect(parseEstimatePayload({ typical_cents: 'nine dollars' }).ok).toBe(false);
  });
});
