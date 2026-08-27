/**
 * Expected self-list price sources. v1: eBay Browse active listings (asking
 * prices). Later: paid sold-comps behind the same interface.
 */
export interface ExpectedPriceSource {
  expectedSelfListCents(isbn13: string): Promise<number | null>;
}

export class NullExpectedPriceSource implements ExpectedPriceSource {
  async expectedSelfListCents(isbn13: string): Promise<number | null> {
    void isbn13;
    return null;
  }
}

export class FixtureExpectedPriceSource implements ExpectedPriceSource {
  constructor(private readonly map: Record<string, number>) {}

  async expectedSelfListCents(isbn13: string): Promise<number | null> {
    return this.map[isbn13] ?? null;
  }
}

type EbayItemSummary = {
  price?: { value?: string; currency?: string };
};

type EbaySearchResponse = {
  itemSummaries?: EbayItemSummary[];
};

/**
 * eBay Browse API — active listings only (asking prices, not sold).
 * Client-credentials OAuth. Conservative ceiling = 25th percentile of USD asks.
 */
export class EbayBrowseExpectedPriceSource implements ExpectedPriceSource {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly options: {
      clientId: string;
      clientSecret: string;
      fetch?: typeof globalThis.fetch;
      marketplaceId?: string;
    },
  ) {}

  private get fetchFn() {
    return this.options.fetch ?? globalThis.fetch;
  }

  private async accessToken(): Promise<string | null> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }
    const basic = Buffer.from(
      `${this.options.clientId}:${this.options.clientSecret}`,
    ).toString('base64');
    try {
      const res = await this.fetchFn('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
        body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) return null;
      this.token = {
        value: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
      };
      return this.token.value;
    } catch {
      return null;
    }
  }

  async expectedSelfListCents(isbn13: string): Promise<number | null> {
    const token = await this.accessToken();
    if (!token) return null;
    const marketplace = this.options.marketplaceId ?? 'EBAY_US';
    const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    url.searchParams.set('q', isbn13);
    url.searchParams.set('limit', '20');
    url.searchParams.set('filter', 'conditions:{USED|NEW}');

    try {
      const res = await this.fetchFn(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': marketplace,
          Accept: 'application/json',
        },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as EbaySearchResponse;
      const prices = (data.itemSummaries ?? [])
        .map((item) => {
          if (item.price?.currency && item.price.currency !== 'USD') return null;
          const value = Number(item.price?.value);
          if (!Number.isFinite(value) || value <= 0) return null;
          return Math.round(value * 100);
        })
        .filter((n): n is number => n != null)
        .sort((a, b) => a - b);

      if (prices.length === 0) return null;
      // Conservative ceiling: 25th percentile of active asks (not optimistic).
      const index = Math.max(0, Math.floor((prices.length - 1) * 0.25));
      return prices[index] ?? null;
    } catch {
      return null;
    }
  }
}

/** Which source produced a number — shown next to the price in the UI. */
export type ExpectedPriceSourceKind = 'ebay_browse' | 'web_estimate' | 'none';

export function expectedPriceSourceKind(options: {
  ebayClientId?: string | null;
  ebayClientSecret?: string | null;
  anthropicApiKey?: string | null;
}): ExpectedPriceSourceKind {
  if (options.ebayClientId && options.ebayClientSecret) return 'ebay_browse';
  if (options.anthropicApiKey) return 'web_estimate';
  return 'none';
}

/**
 * Async because the web-search source is server-only and pulled in on demand,
 * keeping the Anthropic SDK out of the import graph when eBay keys are set.
 */
export async function createExpectedPriceSource(options: {
  ebayClientId?: string | null;
  ebayClientSecret?: string | null;
  /** Fallback while eBay approval is pending: search the open web. */
  anthropicApiKey?: string | null;
  fetch?: typeof globalThis.fetch;
}): Promise<ExpectedPriceSource> {
  if (options.ebayClientId && options.ebayClientSecret) {
    return new EbayBrowseExpectedPriceSource({
      clientId: options.ebayClientId,
      clientSecret: options.ebayClientSecret,
      fetch: options.fetch,
    });
  }
  if (options.anthropicApiKey) {
    const { WebSearchExpectedPriceSource } = await import('@/lib/sell/web-estimate');
    return new WebSearchExpectedPriceSource({ apiKey: options.anthropicApiKey });
  }
  return new NullExpectedPriceSource();
}
