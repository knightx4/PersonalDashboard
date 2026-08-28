/**
 * Pure product-HTML parsing for saved-item enrichment.
 *
 * Ladder, highest trust first:
 *   1. JSON-LD Product / Offer
 *   2. Open Graph + product: meta tags
 *   3. <title> tag (when it is not just the site name)
 *   4. Product slug from the URL (Amazon /dp/…, etc.)
 *   5. Caller supplies / edits fields manually
 *
 * Network fetch + SSRF guards live in scrape-product.ts.
 *
 * Big retailers often serve bots a generic homepage OG card ("Amazon" + logo).
 * We detect that junk and fall through to title/URL slug instead of trusting it.
 */
import { z } from 'zod';
import { parseDollarsToCents } from '@/lib/money';

export const scrapedProductSchema = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  priceCents: z.number().int().nullable(),
  currency: z.string().length(3),
  source: z.enum(['json_ld', 'open_graph', 'document_title', 'url', 'none']),
});

export type ScrapedProduct = z.infer<typeof scrapedProductSchema>;

/** Parse dollars / schema.org price strings into integer cents, or null. */
export function parsePriceToCents(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return null;
    try {
      return parseDollarsToCents(raw.toFixed(2));
    } catch {
      return null;
    }
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return parseDollarsToCents(trimmed);
  } catch {
    // "USD 39.00", "39.00 USD", "£39.00"
    const match = trimmed.match(/(-?\d[\d,]*(?:\.\d{1,2})?)/);
    if (!match) return null;
    try {
      return parseDollarsToCents(match[1]!);
    } catch {
      return null;
    }
  }
}

function normalizeCurrency(raw: unknown, fallback = 'USD'): string {
  if (typeof raw !== 'string') return fallback;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : fallback;
}

function absolutize(maybeUrl: string | null | undefined, baseUrl: string): string | null {
  if (!maybeUrl) return null;
  const trimmed = maybeUrl.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

function metaContent(html: string, attr: 'property' | 'name', key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(
      `<meta[^>]+${attr}\\s*=\\s*["']${escaped}["'][^>]+content\\s*=\\s*["']([^"']+)["']`,
      'i',
    ),
    new RegExp(
      `<meta[^>]+content\\s*=\\s*["']([^"']+)["'][^>]+${attr}\\s*=\\s*["']${escaped}["']`,
      'i',
    ),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtmlEntities(match[1].trim());
  }
  return null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function extractJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re =
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Merchants ship broken JSON-LD often enough; skip and keep looking.
    }
  }
  return blocks;
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function nodeTypes(node: Record<string, unknown>): string[] {
  const type = node['@type'];
  if (typeof type === 'string') return [type.toLowerCase()];
  if (Array.isArray(type)) {
    return type
      .filter((entry): entry is string => typeof entry === 'string')
      .map((t) => t.toLowerCase());
  }
  return [];
}

function walkJsonLd(node: unknown, visit: (obj: Record<string, unknown>) => void): void {
  if (node == null) return;
  if (Array.isArray(node)) {
    for (const entry of node) walkJsonLd(entry, visit);
    return;
  }
  if (typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  visit(obj);
  if (obj['@graph']) walkJsonLd(obj['@graph'], visit);
}

function firstImage(value: unknown, baseUrl: string): string | null {
  for (const entry of asArray(value)) {
    if (typeof entry === 'string') {
      const abs = absolutize(entry, baseUrl);
      if (abs && !isGenericImageUrl(abs)) return abs;
    }
    if (entry && typeof entry === 'object') {
      const url = (entry as { url?: unknown }).url;
      if (typeof url === 'string') {
        const abs = absolutize(url, baseUrl);
        if (abs && !isGenericImageUrl(abs)) return abs;
      }
    }
  }
  return null;
}

function offerFields(offer: Record<string, unknown>): {
  priceCents: number | null;
  currency: string | null;
} {
  const priceCents =
    parsePriceToCents(offer.price) ??
    parsePriceToCents(offer.lowPrice) ??
    parsePriceToCents(offer.highPrice);
  const currency = offer.priceCurrency != null ? normalizeCurrency(offer.priceCurrency) : null;
  return { priceCents, currency };
}

function fromJsonLd(html: string, baseUrl: string): Partial<ScrapedProduct> | null {
  const blocks = extractJsonLdBlocks(html);
  const products: Partial<ScrapedProduct>[] = [];

  for (const block of blocks) {
    walkJsonLd(block, (node) => {
      const types = nodeTypes(node);
      if (!types.includes('product')) return;

      const rawTitle =
        (typeof node.name === 'string' && node.name.trim()) ||
        (typeof node.title === 'string' && node.title.trim()) ||
        null;
      const title = rawTitle && !isGenericTitle(rawTitle, baseUrl) ? rawTitle : null;
      const imageUrl = firstImage(node.image, baseUrl);

      let priceCents: number | null = null;
      let currency: string | null = null;
      for (const offer of asArray(node.offers)) {
        if (!offer || typeof offer !== 'object') continue;
        const fields = offerFields(offer as Record<string, unknown>);
        if (fields.priceCents != null && priceCents == null) priceCents = fields.priceCents;
        if (fields.currency && !currency) currency = fields.currency;
      }

      products.push({
        title,
        imageUrl,
        priceCents,
        currency: currency ?? 'USD',
        source: 'json_ld',
      });
    });
  }

  if (products.length === 0) return null;

  const best: Partial<ScrapedProduct> = { source: 'json_ld', currency: 'USD' };
  for (const candidate of products) {
    if (!best.title && candidate.title) best.title = candidate.title;
    if (!best.imageUrl && candidate.imageUrl) best.imageUrl = candidate.imageUrl;
    if (best.priceCents == null && candidate.priceCents != null) {
      best.priceCents = candidate.priceCents;
    }
    if (candidate.currency) best.currency = candidate.currency;
  }

  if (best.title || best.imageUrl || best.priceCents != null) return best;
  return null;
}

function fromOpenGraph(html: string, baseUrl: string): Partial<ScrapedProduct> | null {
  const rawTitle =
    metaContent(html, 'property', 'og:title') ??
    metaContent(html, 'name', 'twitter:title') ??
    null;
  const title = rawTitle && !isGenericTitle(rawTitle, baseUrl) ? rawTitle : null;

  const rawImage = absolutize(
    metaContent(html, 'property', 'og:image') ??
      metaContent(html, 'name', 'twitter:image') ??
      null,
    baseUrl,
  );
  const imageUrl = rawImage && !isGenericImageUrl(rawImage) ? rawImage : null;

  const priceCents =
    parsePriceToCents(metaContent(html, 'property', 'product:price:amount')) ??
    parsePriceToCents(metaContent(html, 'property', 'og:price:amount')) ??
    null;
  const currency = normalizeCurrency(
    metaContent(html, 'property', 'product:price:currency') ??
      metaContent(html, 'property', 'og:price:currency'),
  );

  if (!title && !imageUrl && priceCents == null) return null;
  return { title, imageUrl, priceCents, currency, source: 'open_graph' };
}

function hostBrandNames(pageUrl: string): string[] {
  try {
    const host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '');
    const base = host.split('.')[0] ?? host;
    const names = new Set<string>([host, base, `${base}.com`, `www.${host}`]);
    if (base === 'amazon') {
      names.add('amazon.com');
      names.add('amazon.co.uk');
      names.add('amazon.ca');
      names.add('kindle store');
      names.add('amazon.com: online shopping');
    }
    return [...names];
  } catch {
    return [];
  }
}

/** Site-level titles Amazon & co. serve to bots instead of the product name. */
export function isGenericTitle(title: string, pageUrl: string): boolean {
  const normalized = title.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!normalized) return true;
  if (normalized.length < 3) return true;

  const brands = hostBrandNames(pageUrl);
  if (brands.some((brand) => normalized === brand || normalized === `${brand}.`)) return true;

  // "Amazon.com: Online Shopping…" / "Amazon" / "Welcome to Amazon"
  if (/^(welcome to\s+)?amazon(\.com)?\b/.test(normalized) && normalized.length < 40) {
    return true;
  }
  if (/^amazon(\.com)?\s*[:|\-–—]/.test(normalized) && normalized.length < 28) {
    return true;
  }

  const generic = new Set([
    'home',
    'shop',
    'store',
    'product',
    'products',
    'online shopping',
    'official site',
  ]);
  if (generic.has(normalized)) return true;

  return false;
}

/** Logos, share icons, sprites — not a product image. */
export function isGenericImageUrl(imageUrl: string): boolean {
  const lower = imageUrl.toLowerCase();
  return (
    /share-icons|\/favicon|\/logo|\/sprite|\/nav-?logo|\/site-logo|\/branding|\/apple-touch|\/android-chrome|\/mstile|g\/01\/gno\/|\/fls-na\.amazon|\/ux-core\//.test(
      lower,
    ) || /\/images\/g\/01\/(?:social|share)/.test(lower)
  );
}

function humanizeSlug(slug: string): string {
  return decodeURIComponent(slug)
    .replace(/\+/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Title from a product URL when the page HTML is a bot shell.
 * Amazon: /Origin-Wealth-…/dp/ASIN or /dp/ASIN/… (slug optional).
 */
export function titleFromProductUrl(pageUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }

  const path = url.pathname;

  // /Slug-Name-Here/dp/B0XXXX or /Slug/gp/product/B0XXXX
  const amazonSlug = path.match(
    /\/([^/]{8,})\/(?:dp|gp\/product)\/([A-Z0-9]{8,12})(?:\/|$)/i,
  );
  if (amazonSlug?.[1]) {
    const slug = humanizeSlug(amazonSlug[1]);
    if (slug && !/^(dp|gp|product)$/i.test(slug)) return slug;
  }

  // Bare /dp/ASIN — nothing useful in the path.
  if (/\/(?:dp|gp\/product)\/[A-Z0-9]{8,12}(?:\/|$)/i.test(path)) {
    return null;
  }

  // Shopify-ish /products/some-product-handle
  const products = path.match(/\/products\/([^/?#]+)/i);
  if (products?.[1]) {
    const slug = humanizeSlug(products[1]);
    if (slug.length >= 4) return slug;
  }

  return null;
}

/** Pull a useful name out of <title>, stripping "Amazon.com:" prefixes. */
export function titleFromDocumentTitle(html: string, pageUrl: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!match?.[1]) return null;
  let title = decodeHtmlEntities(match[1]).replace(/\s+/g, ' ').trim();
  if (!title) return null;

  // "Amazon.com: Origin of Wealth: Remaking…: Timms, …: Books"
  title = title.replace(/^amazon\.com\s*:\s*/i, '');
  title = title.replace(/\s*:\s*(books|electronics|clothing|everything else)\s*$/i, '');
  // Drop trailing site name " | Nike" / " – Best Buy"
  title = title.replace(/\s*[\|\-–—]\s*[A-Za-z0-9 .]{2,30}$/, '').trim();

  if (!title || isGenericTitle(title, pageUrl)) return null;
  // Prefer the part before an author/brand colon when still very long Amazon-style
  // "Product Name: Author: Books" — keep the first segment if it looks like a title.
  const segments = title.split(/\s*:\s*/).filter(Boolean);
  if (segments.length >= 2 && segments[0]!.length >= 8) {
    const first = segments[0]!;
    if (!isGenericTitle(first, pageUrl)) return first;
  }
  return title;
}

/** Pure HTML → product fields. No network. */
export function parseProductHtml(html: string, pageUrl: string): ScrapedProduct {
  const jsonLd = fromJsonLd(html, pageUrl);
  const og = fromOpenGraph(html, pageUrl);
  const docTitle = titleFromDocumentTitle(html, pageUrl);
  const urlTitle = titleFromProductUrl(pageUrl);

  const title = jsonLd?.title ?? og?.title ?? docTitle ?? urlTitle ?? null;
  const imageUrl = jsonLd?.imageUrl ?? og?.imageUrl ?? null;
  const priceCents = jsonLd?.priceCents ?? og?.priceCents ?? null;
  const currency = jsonLd?.currency ?? og?.currency ?? 'USD';

  let source: ScrapedProduct['source'] = 'none';
  if (jsonLd?.title || jsonLd?.priceCents != null || jsonLd?.imageUrl) {
    source = 'json_ld';
  } else if (og?.title || og?.priceCents != null || og?.imageUrl) {
    source = 'open_graph';
  } else if (docTitle && title === docTitle) {
    source = 'document_title';
  } else if (urlTitle && title === urlTitle) {
    source = 'url';
  } else if (title || imageUrl || priceCents != null) {
    // Title came from a later ladder step while image/price came earlier.
    if (docTitle && title === docTitle) source = 'document_title';
    else if (urlTitle && title === urlTitle) source = 'url';
    else if (og) source = 'open_graph';
    else source = 'json_ld';
  }

  return scrapedProductSchema.parse({
    url: pageUrl,
    title,
    imageUrl,
    priceCents,
    currency,
    source,
  });
}

export function emptyScrapedProduct(pageUrl: string): ScrapedProduct {
  // Even with no HTML, a product slug in the URL is better than a blank title.
  const urlTitle = titleFromProductUrl(pageUrl);
  return scrapedProductSchema.parse({
    url: pageUrl,
    title: urlTitle,
    imageUrl: null,
    priceCents: null,
    currency: 'USD',
    source: urlTitle ? 'url' : 'none',
  });
}
