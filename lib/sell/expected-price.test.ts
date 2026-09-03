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
    expect(forbidden.lastFailure?.detail).toContain('Buy APIs');

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
