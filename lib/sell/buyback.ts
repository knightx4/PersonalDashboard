/**
 * Buyback quote providers. Interface first; HTTP only when an API key exists.
 * Never scrape vendor sites.
 */
export type BuybackQuote = {
  vendor: string;
  cents: number;
  shippingCents: number;
  url: string | null;
};

export interface BuybackProvider {
  quote(isbn13: string): Promise<BuybackQuote | null>;
}

export class NullBuybackProvider implements BuybackProvider {
  async quote(isbn13: string): Promise<BuybackQuote | null> {
    void isbn13;
    return null;
  }
}

export class FixtureBuybackProvider implements BuybackProvider {
  constructor(private readonly map: Record<string, BuybackQuote>) {}

  async quote(isbn13: string): Promise<BuybackQuote | null> {
    return this.map[isbn13] ?? null;
  }
}

/**
 * Optional BookScouter-style HTTP adapter.
 * Endpoint shape is intentionally narrow; missing key → NullBuybackProvider.
 */
export class HttpBuybackProvider implements BuybackProvider {
  constructor(
    private readonly options: {
      apiKey: string;
      fetch?: typeof globalThis.fetch;
      baseUrl?: string;
    },
  ) {}

  async quote(isbn13: string): Promise<BuybackQuote | null> {
    const fetchFn = this.options.fetch ?? globalThis.fetch;
    const base = this.options.baseUrl ?? 'https://api.bookscouter.com/v1';
    const url = `${base}/prices?isbn=${encodeURIComponent(isbn13)}`;
    try {
      const res = await fetchFn(url, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.options.apiKey}`,
        },
      });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        best?: {
          vendor?: string;
          priceCents?: number;
          price?: number;
          shippingCents?: number;
          url?: string;
        };
      };
      const best = data.best;
      if (!best) return null;
      const cents =
        typeof best.priceCents === 'number'
          ? best.priceCents
          : typeof best.price === 'number'
            ? Math.round(best.price * 100)
            : null;
      if (cents == null || cents < 0) return null;
      return {
        vendor: best.vendor ?? 'Buyback vendor',
        cents,
        shippingCents: best.shippingCents ?? 0,
        url: best.url ?? null,
      };
    } catch {
      return null;
    }
  }
}

export function createBuybackProvider(options: {
  apiKey?: string | null;
  fetch?: typeof globalThis.fetch;
}): BuybackProvider {
  if (options.apiKey) {
    return new HttpBuybackProvider({
      apiKey: options.apiKey,
      fetch: options.fetch,
    });
  }
  return new NullBuybackProvider();
}
