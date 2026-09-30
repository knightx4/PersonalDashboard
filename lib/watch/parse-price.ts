/**
 * Read the lowest price from a ticket or product page's HTML (plan #1292).
 *
 * Two sources, and the more exact one wins:
 *
 *   1. Per-listing data a site embeds in the page. CrowdVolt is the first:
 *      its event pages carry the whole order book in the Next.js flight
 *      payload, so the reading is the cheapest all-in price (fees included),
 *      with every listing's quantity and the best standing offer.
 *   2. JSON-LD offers: an AggregateOffer's lowPrice, highPrice, offerCount
 *      and inventoryLevel, or a plain Offer's price. Sites put the face
 *      price here, before fees.
 *
 * A page that yields no price is an error reading, never a zero. The result
 * maps straight onto core.watch_readings: `value` and `detail` when it
 * worked, `error` when it did not.
 *
 * Pure: no network. The fetch and its SSRF guard are in read-price.ts.
 */
import { extractJsonLdBlocks, walkJsonLd } from '@/lib/saved/parse-product';

/** One listing on the page, in the page's currency (major units, not cents). */
export interface PriceListing {
  price: number;
  /** What a buyer pays with fees, when the page says; null otherwise. */
  all_in: number | null;
  qty: number;
  ticket_type: string | null;
}

export interface PriceDetail {
  /** Where the value came from. */
  source: 'crowdvolt' | 'json_ld';
  currency: string;
  /** True when `value` includes fees (per-listing all-in price). */
  all_in: boolean;
  /** Tickets or items listed, when the page says. */
  count: number | null;
  /** Separate listings, when the page lists them. */
  listings: number | null;
  /** The dearest listing, when the page says. */
  high: number | null;
  /** The best standing offer from a buyer, when the page shows offers. */
  top_offer: number | null;
  /** The listings under the threshold asked for, cheapest first. */
  below?: {
    threshold: number;
    listings: number;
    count: number;
    cheapest: PriceListing[];
  };
}

export type PriceReading =
  | { ok: true; value: number; detail: PriceDetail }
  | { ok: false; error: string };

export interface ParsePriceOptions {
  /** Count the listings priced under this, as the watch's condition does. */
  below?: number;
}

/** How many of the cheapest listings under the threshold a reading keeps. */
const BELOW_KEEP = 10;

const NO_PRICE = 'No price could be read from the page. It may have changed layout.';

export function parsePriceHtml(
  html: string,
  pageUrl: string,
  options: ParsePriceOptions = {},
): PriceReading {
  const jsonLd = fromJsonLd(html);

  const site = siteListings(html, pageUrl);
  if (site && site.listings.length > 0) {
    return fromListings(site, jsonLd?.currency ?? 'USD', options);
  }

  if (jsonLd && jsonLd.low != null) {
    return {
      ok: true,
      value: jsonLd.low,
      detail: {
        source: 'json_ld',
        currency: jsonLd.currency,
        all_in: false,
        count: jsonLd.count,
        listings: jsonLd.offerCount,
        high: jsonLd.high,
        top_offer: null,
      },
    };
  }

  if (site) {
    return { ok: false, error: 'The page lists nothing for sale right now.' };
  }
  return { ok: false, error: NO_PRICE };
}

// --- Per-listing site data -------------------------------------------------

interface SiteListings {
  source: PriceDetail['source'];
  listings: PriceListing[];
  topOffer: number | null;
}

function siteListings(html: string, pageUrl: string): SiteListings | null {
  let host: string;
  try {
    host = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (host === 'crowdvolt.com' || host.endsWith('.crowdvolt.com')) {
    return crowdVoltListings(html);
  }
  return null;
}

/**
 * CrowdVolt event pages are Next.js App Router pages. The order book rides in
 * the flight payload (`self.__next_f.push([1, "…"])` chunks) as
 * `"initialBook":{"buy":[…],"sell":[…]}`: `sell` is the listings (asks),
 * `buy` the offers (bids). Each entry has price, all_in_price and qty.
 */
function crowdVoltListings(html: string): SiteListings | null {
  const flight = nextFlightPayload(html);
  const book = objectAfterKey(flight, '"initialBook":');
  if (!book || typeof book !== 'object') return null;

  const { buy, sell } = book as { buy?: unknown; sell?: unknown };
  if (!Array.isArray(sell)) return null;

  const listings: PriceListing[] = [];
  for (const raw of sell) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    if (entry.is_pending === true) continue;
    const price = toAmount(entry.price);
    const qty = typeof entry.qty === 'number' && Number.isInteger(entry.qty) ? entry.qty : null;
    if (price == null || qty == null || qty <= 0) continue;
    listings.push({
      price,
      all_in: toAmount(entry.all_in_price),
      qty,
      ticket_type: typeof entry.ticket_type === 'string' ? entry.ticket_type : null,
    });
  }

  let topOffer: number | null = null;
  if (Array.isArray(buy)) {
    for (const raw of buy) {
      if (!raw || typeof raw !== 'object') continue;
      const price = toAmount((raw as Record<string, unknown>).price);
      if (price != null && (topOffer == null || price > topOffer)) topOffer = price;
    }
  }

  return { source: 'crowdvolt', listings, topOffer };
}

function fromListings(
  site: SiteListings,
  currency: string,
  options: ParsePriceOptions,
): PriceReading {
  const cost = (l: PriceListing) => l.all_in ?? l.price;
  const sorted = [...site.listings].sort((a, b) => cost(a) - cost(b));
  const allIn = sorted.every((l) => l.all_in != null);

  const detail: PriceDetail = {
    source: site.source,
    currency,
    all_in: allIn,
    count: sorted.reduce((sum, l) => sum + l.qty, 0),
    listings: sorted.length,
    high: cost(sorted[sorted.length - 1]!),
    top_offer: site.topOffer,
  };

  if (options.below != null) {
    const under = sorted.filter((l) => cost(l) < options.below!);
    detail.below = {
      threshold: options.below,
      listings: under.length,
      count: under.reduce((sum, l) => sum + l.qty, 0),
      cheapest: under.slice(0, BELOW_KEEP),
    };
  }

  return { ok: true, value: cost(sorted[0]!), detail };
}

// --- JSON-LD offers --------------------------------------------------------

interface JsonLdPrice {
  low: number | null;
  high: number | null;
  count: number | null;
  offerCount: number | null;
  currency: string;
}

function fromJsonLd(html: string): JsonLdPrice | null {
  let found: JsonLdPrice | null = null;

  const consider = (offer: Record<string, unknown>) => {
    const types = typeOf(offer);
    const isAggregate = types.includes('aggregateoffer');
    if (!isAggregate && !types.includes('offer')) return;

    const low = isAggregate
      ? (toAmount(offer.lowPrice) ?? toAmount(offer.price))
      : toAmount(offer.price) ?? toAmount(offer.lowPrice);
    if (low == null) return;

    const candidate: JsonLdPrice = {
      low,
      high: toAmount(offer.highPrice),
      count: inventoryCount(offer.inventoryLevel),
      offerCount: toCount(offer.offerCount),
      currency: currencyCode(offer.priceCurrency),
    };
    if (!found || candidate.low! < found.low!) found = candidate;
  };

  for (const block of extractJsonLdBlocks(html)) {
    walkJsonLd(block, (node) => {
      for (const offer of asArray(node.offers)) {
        if (offer && typeof offer === 'object') consider(offer as Record<string, unknown>);
      }
    });
  }
  return found;
}

function typeOf(node: Record<string, unknown>): string[] {
  const type = node['@type'];
  if (typeof type === 'string') return [type.toLowerCase()];
  if (Array.isArray(type)) {
    return type.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase());
  }
  return [];
}

function inventoryCount(level: unknown): number | null {
  if (level && typeof level === 'object') {
    return toCount((level as Record<string, unknown>).value);
  }
  return toCount(level);
}

// --- Small readers ---------------------------------------------------------

function asArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

/** A price in major units, rounded to the cent, or null. */
function toAmount(raw: unknown): number | null {
  let n: number | null = null;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string') {
    const match = raw.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
    n = match ? Number(match[0]) : null;
  }
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function toCount(raw: unknown): number | null {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
}

function currencyCode(raw: unknown): string {
  if (typeof raw !== 'string') return 'USD';
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : 'USD';
}

/** Concatenate the string chunks of a Next.js App Router flight payload. */
export function nextFlightPayload(html: string): string {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let out = '';
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    try {
      out += JSON.parse(match[1]!) as string;
    } catch {
      // A chunk that is not a plain JSON string carries nothing we read.
    }
  }
  return out;
}

/** Parse the JSON object that follows `key` in `text`, or null. */
function objectAfterKey(text: string, key: string): unknown {
  const at = text.indexOf(key);
  if (at < 0) return null;
  const start = text.indexOf('{', at + key.length);
  if (start < 0 || text.slice(at + key.length, start).trim() !== '') return null;

  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
