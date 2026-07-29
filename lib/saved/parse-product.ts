/**
 * Pure product-HTML parsing for saved-item enrichment.
 *
 * Ladder, highest trust first:
 *   1. JSON-LD Product / Offer
 *   2. Open Graph + product: meta tags
 *   3. Caller supplies / edits fields manually
 *
 * Network fetch + SSRF guards live in scrape-product.ts.
 */
import { z } from 'zod';
import { parseDollarsToCents } from '@/lib/money';

export const scrapedProductSchema = z.object({
  url: z.string().url(),
  title: z.string().nullable(),
  imageUrl: z.string().url().nullable(),
  priceCents: z.number().int().nullable(),
  currency: z.string().length(3),
  source: z.enum(['json_ld', 'open_graph', 'none']),
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
      if (abs) return abs;
    }
    if (entry && typeof entry === 'object') {
      const url = (entry as { url?: unknown }).url;
      if (typeof url === 'string') {
        const abs = absolutize(url, baseUrl);
        if (abs) return abs;
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

      const title =
        (typeof node.name === 'string' && node.name.trim()) ||
        (typeof node.title === 'string' && node.title.trim()) ||
        null;
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
  const title =
    metaContent(html, 'property', 'og:title') ??
    metaContent(html, 'name', 'twitter:title') ??
    null;
  const imageUrl = absolutize(
    metaContent(html, 'property', 'og:image') ??
      metaContent(html, 'name', 'twitter:image') ??
      null,
    baseUrl,
  );
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

/** Pure HTML → product fields. No network. */
export function parseProductHtml(html: string, pageUrl: string): ScrapedProduct {
  const jsonLd = fromJsonLd(html, pageUrl);
  const og = fromOpenGraph(html, pageUrl);

  const usedJsonLd = Boolean(jsonLd?.title || jsonLd?.priceCents != null || jsonLd?.imageUrl);
  const merged = {
    url: pageUrl,
    title: jsonLd?.title ?? og?.title ?? null,
    imageUrl: jsonLd?.imageUrl ?? og?.imageUrl ?? null,
    priceCents: jsonLd?.priceCents ?? og?.priceCents ?? null,
    currency: jsonLd?.currency ?? og?.currency ?? 'USD',
    source: (usedJsonLd ? 'json_ld' : og ? 'open_graph' : 'none') as ScrapedProduct['source'],
  };

  return scrapedProductSchema.parse(merged);
}

export function emptyScrapedProduct(pageUrl: string): ScrapedProduct {
  return scrapedProductSchema.parse({
    url: pageUrl,
    title: null,
    imageUrl: null,
    priceCents: null,
    currency: 'USD',
    source: 'none',
  });
}
