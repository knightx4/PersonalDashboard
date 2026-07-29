/**
 * Pull retailer product URLs (and images) from ephemeral email HTML/text.
 * Bodies are never stored — callers pass MIME content only for this parse.
 */

export type ProductLinkHint = {
  productUrl: string;
  imageUrl?: string | null;
  /** Amazon ASIN when applicable. */
  asin?: string | null;
  /** True when the ASIN came from an ordered-item title link (not promo chrome). */
  fromOrderedItem?: boolean;
};

const ASIN_RE =
  /(?:amazon\.com\/(?:dp|gp\/product)\/|dp%2F|gp%2Fproduct%2F)([A-Z0-9]{10})/gi;

const ORDERED_ITEM_ASIN_RE =
  /(?:amazon\.com\/(?:dp|gp\/product)\/|dp%2F|gp%2Fproduct%2F)([A-Z0-9]{10})[^"'\\\s<>]*?(?:i_fed_asin_title|asin_title)/gi;

const PROMO_ASIN_RE = /(?:dealz|AGH3Col|_IMG_|_pie)/i;

const AMAZON_IMAGE_RE =
  /https:\/\/(?:m\.media-amazon\.com|images-na\.ssl-images-amazon\.com)\/images\/[^\s"'<>]+?\.(?:jpg|jpeg|png|webp)/gi;

function decodeTrackingUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const nested = url.searchParams.get('U') ?? url.searchParams.get('u');
    if (nested) return decodeURIComponent(nested);
  } catch {
    /* ignore */
  }
  return raw;
}

function collectAsins(
  blob: string,
  pattern: RegExp,
  opts?: { excludePromo?: boolean },
): string[] {
  const asins: string[] = [];
  const seen = new Set<string>();
  for (const match of blob.matchAll(pattern)) {
    const full = match[0] ?? '';
    if (opts?.excludePromo && PROMO_ASIN_RE.test(full)) continue;
    const asin = match[1]?.toUpperCase();
    if (!asin || seen.has(asin)) continue;
    seen.add(asin);
    asins.push(asin);
  }
  return asins;
}

/** Unique Amazon product pages found in a blob of HTML or plain text. */
export function extractAmazonProductLinks(blob: string): ProductLinkHint[] {
  if (!blob) return [];

  const orderedAsins = collectAsins(blob, ORDERED_ITEM_ASIN_RE);
  const allAsins = collectAsins(blob, ASIN_RE, { excludePromo: true });
  const asins = orderedAsins.length > 0 ? orderedAsins : allAsins.length > 0 ? allAsins : collectAsins(blob, ASIN_RE);

  const images = [...blob.matchAll(AMAZON_IMAGE_RE)]
    .map((m) => m[0])
    .filter((url) => !/pixel\.gif|steptracker|sprite/i.test(url));

  return asins.map((asin, index) => ({
    asin,
    productUrl: `https://www.amazon.com/dp/${asin}`,
    imageUrl: images[index] ?? images[0] ?? null,
    fromOrderedItem: orderedAsins.includes(asin),
  }));
}

/** Also unwrap amazon.com/gp/r.html?U=… tracking links into product hints. */
export function extractProductLinksFromEmail(blob: string): ProductLinkHint[] {
  const decoded = blob.replace(
    /https:\/\/www\.amazon\.com\/gp\/r\.html[^"'\\\s<>]*/gi,
    (url) => decodeTrackingUrl(url.replace(/&amp;/g, '&')),
  );
  return extractAmazonProductLinks(`${blob}\n${decoded}`);
}

function significantTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4)
    .slice(0, 6);
}

/**
 * Attach product URLs to extracted lines that lack them.
 * Prefer title/ASIN links; when multiple products exist, match by name tokens in HTML.
 */
export function enrichLinesWithProductLinks<
  T extends {
    name?: string;
    productUrl?: string | null;
    imageUrl?: string | null;
  },
>(lines: T[], hints: ProductLinkHint[], html?: string | null): T[] {
  if (hints.length === 0) return lines;
  const used = new Set<string>();
  const source = html ?? '';

  return lines.map((line, index) => {
    if (line.productUrl) return line;

    let hint: ProductLinkHint | null = null;

    if (line.name && source) {
      const tokens = significantTokens(line.name);
      if (tokens.length > 0) {
        let best: { hint: ProductLinkHint; score: number } | null = null;
        for (const candidate of hints) {
          if (!candidate.asin || used.has(candidate.asin)) continue;
          const idx = source.search(new RegExp(candidate.asin, 'i'));
          if (idx < 0) continue;
          const window = source.slice(Math.max(0, idx - 2500), idx + 400).toLowerCase();
          const score = tokens.reduce((sum, token) => sum + (window.includes(token) ? 1 : 0), 0);
          if (score === 0) continue;
          if (!best || score > best.score) best = { hint: candidate, score };
        }
        if (best) hint = best.hint;
      }
    }

    if (!hint) {
      const remaining = hints.filter((h) => !(h.asin && used.has(h.asin)));
      if (remaining.length === 1) {
        hint = remaining[0] ?? null;
      } else if (remaining.length > 0) {
        hint = remaining[Math.min(index, remaining.length - 1)] ?? null;
      }
    }

    if (!hint) return line;
    if (hint.asin) used.add(hint.asin);
    return {
      ...line,
      productUrl: hint.productUrl,
      imageUrl: line.imageUrl ?? hint.imageUrl ?? null,
    };
  });
}
