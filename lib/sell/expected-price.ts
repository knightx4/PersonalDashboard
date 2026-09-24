/**
 * Expected self-list price sources. v1: eBay Browse active listings (asking
 * prices). Later: paid sold-comps behind the same interface.
 */
import type { SpendSink } from '@/lib/core/spend/pricing';
import {
  priceStats,
  type EvidenceListing,
  type PriceEvidence,
} from '@/lib/sell/price-evidence';

/**
 * Something to price, when an ISBN is not what identifies it.
 *
 * Board games have no ISBN, so the query is a title. That is a materially
 * weaker signal — an ISBN pins one edition, "Catan" matches an expansion, a
 * travel edition and a jigsaw — hence the hint, which the web-search source
 * uses to say what kind of thing it is looking at.
 */
export type PriceSubject = {
  query: string;
  hint?: string | null;
};

export interface ExpectedPriceSource {
  expectedSelfListCents(isbn13: string): Promise<number | null>;
  /** Price anything not identified by an ISBN. */
  expectedSelfListCentsFor(subject: PriceSubject): Promise<number | null>;
  /**
   * The same lookup, keeping what it saw.
   *
   * Optional, and paired with the two above rather than replacing them, so each
   * source keeps its own query shaping -- eBay wants a bare ISBN in `q`, the
   * web search wants a sentence. A caller that has these must use them instead
   * of the number methods, never as well: a web estimate is billed per call.
   */
  priceEvidenceForIsbn?(isbn13: string): Promise<PriceEvidence | null>;
  priceEvidence?(subject: PriceSubject): Promise<PriceEvidence | null>;
}

export class NullExpectedPriceSource implements ExpectedPriceSource {
  async expectedSelfListCents(isbn13: string): Promise<number | null> {
    void isbn13;
    return null;
  }

  async expectedSelfListCentsFor(subject: PriceSubject): Promise<number | null> {
    void subject;
    return null;
  }
}

export class FixtureExpectedPriceSource implements ExpectedPriceSource {
  constructor(private readonly map: Record<string, number>) {}

  async expectedSelfListCents(isbn13: string): Promise<number | null> {
    return this.map[isbn13] ?? null;
  }

  async expectedSelfListCentsFor(subject: PriceSubject): Promise<number | null> {
    return this.map[subject.query] ?? null;
  }
}

type EbayItemSummary = {
  itemId?: string;
  title?: string;
  itemWebUrl?: string;
  condition?: string;
  price?: { value?: string; currency?: string };
  shippingOptions?: { shippingCost?: { value?: string; currency?: string } }[];
};

type EbaySearchResponse = {
  total?: number;
  itemSummaries?: EbayItemSummary[];
};

/** Money as Browse reports it: a decimal string, and only USD is usable here. */
function usdCents(money?: { value?: string; currency?: string }): number | null {
  if (!money) return null;
  if (money.currency && money.currency !== 'USD') return null;
  const value = Number(money.value);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/**
 * Why a Browse lookup produced no number.
 *
 * Every failure used to collapse into `null`, which reads exactly like "this
 * book genuinely has no listings" — so a keyset eBay refused at the OAuth step
 * looked identical to an obscure paperback, and nothing on the outside could
 * tell them apart. The lookup still returns `null`, because the callers want a
 * number or nothing, but the reason is kept and logged.
 */
export type EbayFailure = {
  stage: 'credentials' | 'oauth' | 'search' | 'no_results';
  status?: number;
  detail: string;
};

/** How many listings one search reads. Browse allows more; 20 is plenty. */
const SEARCH_LIMIT = 20;

/** eBay keyset IDs carry their environment: `App-Name-PRD-…` or `…-SBX-…`. */
export function ebayKeysetEnvironment(
  clientId: string,
): 'production' | 'sandbox' | 'unknown' {
  if (/-PRD-/i.test(clientId)) return 'production';
  if (/-SBX-/i.test(clientId)) return 'sandbox';
  return 'unknown';
}

/** eBay's error body is the useful half of a 4xx. Keep it short and readable. */
export function summarizeEbayError(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return 'no response body';
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: string;
      error_description?: string;
      errors?: { message?: string; longMessage?: string }[];
    };
    if (parsed.error || parsed.error_description) {
      return [parsed.error, parsed.error_description].filter(Boolean).join(': ');
    }
    const first = parsed.errors?.[0];
    if (first) return first.longMessage ?? first.message ?? trimmed.slice(0, 200);
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return trimmed.slice(0, 200);
}

/**
 * eBay Browse API — active listings only (asking prices, not sold).
 * Client-credentials OAuth. The price acted on is a percentile of USD asks —
 * see priceStats, which also decides when a market is too thin for one.
 */
export class EbayBrowseExpectedPriceSource implements ExpectedPriceSource {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly clientId: string;
  private readonly clientSecret: string;

  /** Why the most recent lookup came back empty. Null once one succeeds. */
  lastFailure: EbayFailure | null = null;

  constructor(
    private readonly options: {
      clientId: string;
      clientSecret: string;
      fetch?: typeof globalThis.fetch;
      marketplaceId?: string;
    },
  ) {
    // A key pasted into a dashboard field arrives with stray whitespace
    // surprisingly often, and an untrimmed secret fails as `invalid_client` —
    // indistinguishable from a genuinely wrong key, and invisible in the UI
    // that holds it.
    this.clientId = options.clientId.trim();
    this.clientSecret = options.clientSecret.trim();
  }

  private get fetchFn() {
    return this.options.fetch ?? globalThis.fetch;
  }

  /**
   * Record a failure and return null. Warns rather than throws: one unpriceable
   * book must not take down a shelf. Repeats are not re-logged, so a batch of
   * fifteen books with one broken keyset writes one line, not fifteen.
   */
  private fail(failure: EbayFailure): null {
    const repeat =
      this.lastFailure?.stage === failure.stage &&
      this.lastFailure?.detail === failure.detail;
    this.lastFailure = failure;
    if (!repeat) console.warn(`[ebay] ${failure.stage}: ${failure.detail}`);
    return null;
  }

  private async accessToken(): Promise<string | null> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) {
      return this.token.value;
    }
    if (!this.clientId || !this.clientSecret) {
      return this.fail({
        stage: 'credentials',
        detail: 'client id or secret is empty after trimming whitespace',
      });
    }
    if (ebayKeysetEnvironment(this.clientId) === 'sandbox') {
      return this.fail({
        stage: 'credentials',
        detail: 'sandbox keyset (-SBX-); sandbox returns invented listings',
      });
    }
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');
    try {
      const res = await this.fetchFn('https://api.ebay.com/identity/v1/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
        body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
      });
      if (!res.ok) {
        const detail = summarizeEbayError(await res.text().catch(() => ''));
        return this.fail({
          stage: 'oauth',
          status: res.status,
          detail: `${res.status} ${detail}`,
        });
      }
      const data = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!data.access_token) {
        return this.fail({
          stage: 'oauth',
          detail: 'token response carried no access_token',
        });
      }
      this.token = {
        value: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 7200) * 1000,
      };
      return this.token.value;
    } catch (error) {
      return this.fail({
        stage: 'oauth',
        detail: error instanceof Error ? error.message : 'token request failed',
      });
    }
  }

  async expectedSelfListCents(isbn13: string): Promise<number | null> {
    return this.searchCents(isbn13);
  }

  /** Browse searches free text, so a title works the same way an ISBN does. */
  async expectedSelfListCentsFor(subject: PriceSubject): Promise<number | null> {
    return this.searchCents(subject.query);
  }

  async priceEvidenceForIsbn(isbn13: string): Promise<PriceEvidence | null> {
    return this.search(isbn13);
  }

  async priceEvidence(subject: PriceSubject): Promise<PriceEvidence | null> {
    return this.search(subject.query);
  }

  private async searchCents(query: string): Promise<number | null> {
    return (await this.search(query))?.typicalCents ?? null;
  }

  /**
   * One Browse search, kept whole.
   *
   * Everything but the price used to be dropped on the floor here, which made
   * the resulting number impossible to check. The listings cost nothing extra
   * -- they are in the response either way -- so they are carried out.
   */
  private async search(query: string): Promise<PriceEvidence | null> {
    const token = await this.accessToken();
    if (!token) return null;
    const marketplace = this.options.marketplaceId ?? 'EBAY_US';
    const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search');
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(SEARCH_LIMIT));
    url.searchParams.set('filter', 'conditions:{USED|NEW}');
    // Deliberately unsorted, which means eBay's Best Match.
    //
    // Asking for sort=price looks helpful and is not: it returns the twenty
    // CHEAPEST listings in the market, so any percentile of that sample is a
    // percentile of the bottom of the market rather than of the market. On a
    // title with two hundred listings that is a low single-digit percentile,
    // so every price came out a fraction of what the item is worth. The sample
    // has to be representative for the percentile to mean anything; the
    // listings are sorted below, for display, once they are all in hand.

    try {
      const res = await this.fetchFn(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': marketplace,
          Accept: 'application/json',
        },
      });
      if (!res.ok) {
        const detail = summarizeEbayError(await res.text().catch(() => ''));
        // A keyset can authenticate fine and still not be cleared for Browse:
        // the Buy APIs are granted separately, and that arrives here as a 403.
        this.fail({ stage: 'search', status: res.status, detail: `${res.status} ${detail}` });
        return null;
      }
      const data = (await res.json()) as EbaySearchResponse;

      const listings: EvidenceListing[] = [];
      for (const item of data.itemSummaries ?? []) {
        const priceCents = usdCents(item.price);
        // A listing with no usable USD price cannot join the statistics, and
        // showing it without one would only raise the question of why.
        if (priceCents == null || priceCents <= 0) continue;
        listings.push({
          title: item.title ?? null,
          url: item.itemWebUrl ?? null,
          priceCents,
          shippingCents: usdCents(item.shippingOptions?.[0]?.shippingCost),
          condition: item.condition ?? null,
        });
      }

      const stats = priceStats(listings.map((l) => l.priceCents!));
      if (!stats) {
        // Genuinely empty, and now labelled as such -- this is the one "null"
        // that means the book, not the configuration.
        this.fail({ stage: 'no_results', detail: `no USD listings for "${query}"` });
        return null;
      }

      this.lastFailure = null;
      listings.sort((a, b) => (a.priceCents ?? 0) - (b.priceCents ?? 0));
      return {
        source: 'ebay_browse',
        typicalCents: stats.typicalCents,
        lowCents: stats.minCents,
        highCents: stats.maxCents,
        medianCents: stats.medianCents,
        typicalBasis: stats.typicalBasis,
        sampleSize: stats.count,
        totalMatches: typeof data.total === 'number' ? data.total : null,
        listings,
        note: null,
        query,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.fail({
        stage: 'search',
        detail: error instanceof Error ? error.message : 'Browse request failed',
      });
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
  /** What each web-search estimate cost; record it as 'estimate-resale-price'. */
  onSpend?: SpendSink;
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
    return new WebSearchExpectedPriceSource({
      apiKey: options.anthropicApiKey,
      onSpend: options.onSpend,
    });
  }
  return new NullExpectedPriceSource();
}
