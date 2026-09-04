import { describe, expect, it, vi } from 'vitest';
import {
  EbayBrowseExpectedPriceSource,
  ebayKeysetEnvironment,
  summarizeEbayError,
} from './expected-price';

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** A fetch that answers the token call, then hands the search call to `search`. */
function fakeFetch(options: {
  token?: Response;
  search?: (url: string, init?: RequestInit) => Response;
  onTokenRequest?: (init?: RequestInit) => void;
}): typeof globalThis.fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === TOKEN_URL) {
      options.onTokenRequest?.(init);
      return options.token ?? jsonResponse({ access_token: 'tok', expires_in: 7200 });
    }
    return options.search?.(url, init) ?? jsonResponse({ itemSummaries: [] });
  }) as typeof globalThis.fetch;
}

function summaries(...values: string[]) {
  return { itemSummaries: values.map((value) => ({ price: { value, currency: 'USD' } })) };
}

describe('ebayKeysetEnvironment', () => {
  it('reads the environment out of the keyset id', () => {
    expect(ebayKeysetEnvironment('Shelf-Shelf-PRD-1a2b3c-4d5e')).toBe('production');
    expect(ebayKeysetEnvironment('Shelf-Shelf-SBX-1a2b3c-4d5e')).toBe('sandbox');
    expect(ebayKeysetEnvironment('not-a-keyset')).toBe('unknown');
  });
});

describe('summarizeEbayError', () => {
  it('pulls the description out of an OAuth error', () => {
    expect(
      summarizeEbayError('{"error":"invalid_client","error_description":"client not found"}'),
    ).toBe('invalid_client: client not found');
  });

  it('pulls the long message out of a Browse error', () => {
    expect(summarizeEbayError('{"errors":[{"longMessage":"Access denied"}]}')).toBe(
      'Access denied',
    );
  });

  it('falls back to raw text and reports an empty body', () => {
    expect(summarizeEbayError('<html>502</html>')).toBe('<html>502</html>');
    expect(summarizeEbayError('   ')).toBe('no response body');
  });
});

describe('EbayBrowseExpectedPriceSource', () => {
  it('returns the 25th percentile of USD asks and records no failure', async () => {
    const source = new EbayBrowseExpectedPriceSource({
      clientId: 'App-App-PRD-1-2',
      clientSecret: 'secret',
      fetch: fakeFetch({
        search: () =>
          jsonResponse(summaries('10.00', '20.00', '30.00', '40.00', '50.00')),
      }),
    });

    expect(await source.expectedSelfListCents('9780735211292')).toBe(2000);
    expect(source.lastFailure).toBeNull();
  });

  it('refuses a sandbox keyset before making any request', async () => {
    const fetchSpy = vi.fn();
    const source = new EbayBrowseExpectedPriceSource({
      clientId: 'App-App-SBX-1-2',
      clientSecret: 'secret',
      fetch: fetchSpy as unknown as typeof globalThis.fetch,
    });

    expect(await source.expectedSelfListCents('9780735211292')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(source.lastFailure?.stage).toBe('credentials');
    expect(source.lastFailure?.detail).toContain('sandbox');
  });

  it('trims whitespace off credentials before signing the token request', async () => {
    let authorization: string | undefined;
    const source = new EbayBrowseExpectedPriceSource({
      clientId: '  App-App-PRD-1-2  ',
      clientSecret: 'secret\n',
      fetch: fakeFetch({
        onTokenRequest: (init) => {
          authorization = new Headers(init?.headers).get('authorization') ?? undefined;
        },
        search: () => jsonResponse(summaries('12.00')),
      }),
    });

    await source.expectedSelfListCents('9780735211292');
    const expected = Buffer.from('App-App-PRD-1-2:secret').toString('base64');
    expect(authorization).toBe(`Basic ${expected}`);
  });

  it('reports a refused keyset instead of a bare null', async () => {
    const source = new EbayBrowseExpectedPriceSource({
      clientId: 'App-App-PRD-1-2',
      clientSecret: 'wrong',
      fetch: fakeFetch({
        token: jsonResponse({ error: 'invalid_client' }, 401),
      }),
    });

    expect(await source.expectedSelfListCents('9780735211292')).toBeNull();
    expect(source.lastFailure?.stage).toBe('oauth');
    expect(source.lastFailure?.status).toBe(401);
    expect(source.lastFailure?.detail).toContain('invalid_client');
  });

  it('distinguishes a keyset without Browse access from a missing book', async () => {
    const forbidden = new EbayBrowseExpectedPriceSource({
      clientId: 'App-App-PRD-1-2',
      clientSecret: 'secret',
      fetch: fakeFetch({
        search: () => jsonResponse({ errors: [{ message: 'Insufficient permissions' }] }, 403),
      }),
    });
    expect(await forbidden.expectedSelfListCents('9780735211292')).toBeNull();
    expect(forbidden.lastFailure?.stage).toBe('search');
    expect(forbidden.lastFailure?.status).toBe(403);
    expect(forbidden.lastFailure?.detail).toContain('Insufficient permissions');

    const empty = new EbayBrowseExpectedPriceSource({
      clientId: 'App-App-PRD-1-2',
      clientSecret: 'secret',
      fetch: fakeFetch({ search: () => jsonResponse({ itemSummaries: [] }) }),
    });
    expect(await empty.expectedSelfListCents('9780735211292')).toBeNull();
    expect(empty.lastFailure?.stage).toBe('no_results');
  });

  it('ignores non-USD listings, and says so when nothing usable is left', async () => {
    const source = new EbayBrowseExpectedPriceSource({
      clientId: 'App-App-PRD-1-2',
      clientSecret: 'secret',
      fetch: fakeFetch({
        search: () =>
          jsonResponse({ itemSummaries: [{ price: { value: '18.00', currency: 'GBP' } }] }),
      }),
    });

    expect(await source.expectedSelfListCents('9780735211292')).toBeNull();
    expect(source.lastFailure?.stage).toBe('no_results');
  });
});

describe('EbayBrowseExpectedPriceSource evidence', () => {
  const browseResponse = {
    total: 340,
    itemSummaries: [
      {
        itemId: 'v1|1|0',
        title: 'Atomic Habits paperback',
        itemWebUrl: 'https://www.ebay.com/itm/1',
        condition: 'Good',
        price: { value: '8.00', currency: 'USD' },
        shippingOptions: [{ shippingCost: { value: '0.00', currency: 'USD' } }],
      },
      {
        itemId: 'v1|2|0',
        title: 'Atomic Habits hardcover',
        itemWebUrl: 'https://www.ebay.com/itm/2',
        condition: 'Very Good',
        price: { value: '12.00', currency: 'USD' },
        shippingOptions: [{ shippingCost: { value: '3.99', currency: 'USD' } }],
      },
      // Not USD: excluded from both the statistics and the listing table.
      { itemId: 'v1|3|0', title: 'UK copy', price: { value: '9.00', currency: 'GBP' } },
      {
        itemId: 'v1|4|0',
        title: 'Signed first printing',
        itemWebUrl: 'https://www.ebay.com/itm/4',
        price: { value: '90.00', currency: 'USD' },
      },
    ],
  };

  function source() {
    return new EbayBrowseExpectedPriceSource({
      clientId: 'App-App-PRD-1-2',
      clientSecret: 'secret',
      fetch: fakeFetch({ search: () => jsonResponse(browseResponse) }),
    });
  }

  it('keeps the listings, the spread and the market size', async () => {
    const evidence = (await source().priceEvidenceForIsbn('9780735211292'))!;

    expect(evidence.source).toBe('ebay_browse');
    expect(evidence.sampleSize).toBe(3); // the GBP listing is not counted
    expect(evidence.totalMatches).toBe(340);
    expect(evidence.lowCents).toBe(800);
    expect(evidence.highCents).toBe(9000);
    expect(evidence.query).toBe('9780735211292');

    expect(evidence.listings.map((l) => l.priceCents)).toEqual([800, 1200, 9000]);
    expect(evidence.listings[0]).toMatchObject({
      title: 'Atomic Habits paperback',
      url: 'https://www.ebay.com/itm/1',
      condition: 'Good',
      shippingCents: 0,
    });
    // Absent shipping is unknown, not free.
    expect(evidence.listings[2]?.shippingCents).toBeNull();
    expect(evidence.listings.some((l) => l.title === 'UK copy')).toBe(false);
  });

  it('agrees with the number the router still routes on', async () => {
    const evidence = await source().priceEvidenceForIsbn('9780735211292');
    const cents = await source().expectedSelfListCents('9780735211292');
    expect(cents).toBe(evidence?.typicalCents);
  });

  it('returns null with the reason recorded when nothing is listed', async () => {
    const empty = new EbayBrowseExpectedPriceSource({
      clientId: 'App-App-PRD-1-2',
      clientSecret: 'secret',
      fetch: fakeFetch({ search: () => jsonResponse({ itemSummaries: [] }) }),
    });
    expect(await empty.priceEvidenceForIsbn('9780735211292')).toBeNull();
    expect(empty.lastFailure?.stage).toBe('no_results');
  });
});

describe('the Browse query itself', () => {
  it('does not ask eBay to sort by price', async () => {
    // A price sort would return the cheapest twenty listings, making the
    // percentile taken from them a percentile of the bottom of the market.
    let requested = '';
    const source = new EbayBrowseExpectedPriceSource({
      clientId: 'App-App-PRD-1-2',
      clientSecret: 'secret',
      fetch: fakeFetch({
        search: (url) => {
          requested = url;
          return jsonResponse(summaries('10.00'));
        },
      }),
    });

    await source.expectedSelfListCents('9780735211292');
    expect(requested).not.toContain('sort');
    expect(requested).toContain('limit=20');
    expect(requested).toContain('q=9780735211292');
  });
});
