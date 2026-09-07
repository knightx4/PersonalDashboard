/**
 * The panel is the whole point of keeping the evidence, so it is rendered
 * rather than asserted about: what matters is that the listing links come out
 * clickable and that a citation is not dressed up as an offer.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PriceEvidenceDetail } from '@/app/shopping/inventory/[id]/price-evidence-detail';
import type { PriceEvidence } from '@/lib/sell/price-evidence';

const ebay: PriceEvidence = {
  source: 'ebay_browse',
  typicalCents: 800,
  lowCents: 800,
  highCents: 9000,
  medianCents: 1200,
  typicalBasis: 'percentile',
  sampleSize: 3,
  totalMatches: 340,
  listings: [
    { title: 'Atomic Habits paperback', url: 'https://www.ebay.com/itm/1', priceCents: 800, shippingCents: 0, condition: 'Good' },
    { title: 'Atomic Habits hardcover', url: 'https://www.ebay.com/itm/2', priceCents: 1200, shippingCents: 399, condition: 'Very Good' },
    { title: 'Signed first printing', url: 'https://www.ebay.com/itm/4', priceCents: 9000, shippingCents: null, condition: null },
  ],
  note: null,
  query: '9780735211292',
  fetchedAt: '2026-09-04T00:00:00.000Z',
};

describe('PriceEvidenceDetail', () => {
  it('shows the spread, the market size and every listing as a link', () => {
    const html = renderToStaticMarkup(<PriceEvidenceDetail evidence={ebay} />);

    expect(html).toContain('3 listings');
    expect(html).toContain('$8.00–$90.00');
    expect(html).toContain('median $12.00');
    expect(html).toContain('340 listed in total');

    for (const n of [1, 2, 4]) {
      expect(html).toContain(`href="https://www.ebay.com/itm/${n}"`);
    }
    expect(html).toContain('target="_blank"');
    expect(html).toContain('Very Good');
    expect(html).toContain('+ free ship');
    expect(html).toContain('+ $3.99 ship');
    // The query is surfaced, because a wrong price is usually a wrong search.
    expect(html).toContain('9780735211292');
  });

  it('shows a web estimate as sources, with no invented prices', () => {
    const html = renderToStaticMarkup(
      <PriceEvidenceDetail
        evidence={{
          ...ebay,
          source: 'web_estimate',
          medianCents: null,
          typicalBasis: null,
          sampleSize: null,
          totalMatches: null,
          note: 'Based on completed listings.',
          listings: [
            { title: 'AbeBooks listing page', url: 'https://abebooks.com/x', priceCents: null, shippingCents: null, condition: null },
          ],
        }}
      />,
    );

    expect(html).toContain('1 source');
    expect(html).toContain('Based on completed listings.');
    expect(html).toContain('href="https://abebooks.com/x"');
    // Counted as sources, not listings, and no market statistics implied.
    expect(html).not.toContain('1 listing');
    expect(html).not.toContain('median');
    expect(html).not.toContain('listed in total');
    // A citation carries no price, so no price or shipping is rendered for it.
    expect(html).not.toContain('ship');
  });

  it('renders nothing when there is neither a range nor a listing', () => {
    const html = renderToStaticMarkup(
      <PriceEvidenceDetail
        evidence={{ ...ebay, lowCents: null, highCents: null, listings: [] }}
      />,
    );
    expect(html).toBe('');
  });
});

describe('PriceEvidenceDetail thin markets', () => {
  it('warns when too few listings to rank, and stays quiet when there are enough', () => {
    const thin = renderToStaticMarkup(
      <PriceEvidenceDetail
        evidence={{ ...ebay, sampleSize: 3, typicalBasis: 'median' }}
      />,
    );
    expect(thin).toContain('too few to rank');

    const healthy = renderToStaticMarkup(
      <PriceEvidenceDetail
        evidence={{ ...ebay, sampleSize: 20, typicalBasis: 'percentile' }}
      />,
    );
    expect(healthy).not.toContain('too few to rank');
  });
});
