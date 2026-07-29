/**
 * Pull retailer product URLs (and images) from ephemeral email HTML/text.
 * Bodies are never stored — callers pass MIME content only for this parse.
 */

export type ProductLinkHint = {
  productUrl: string;
  imageUrl?: string | null;
  /** Amazon ASIN when applicable. */
  asin?: string | null;
};

const ASIN_RE =
  /(?:amazon\.com\/(?:dp|gp\/product)\/|dp%2F|gp%2Fproduct%2F)([A-Z0-9]{10})/gi;

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

/** Unique Amazon product pages found in a blob of HTML or plain text. */
export function extractAmazonProductLinks(blob: string): ProductLinkHint[] {
  if (!blob) return [];

  const asins: string[] = [];
  const seen = new Set<string>();
  for (const match of blob.matchAll(ASIN_RE)) {
    const asin = match[1]?.toUpperCase();
    if (!asin || seen.has(asin)) continue;
    seen.add(asin);
    asins.push(asin);
  }

  const images = [...blob.matchAll(AMAZON_IMAGE_RE)]
    .map((m) => m[0])
    .filter((url) => !/pixel\.gif|steptracker|sprite/i.test(url));

  return asins.map((asin, index) => ({
    asin,
    productUrl: `https://www.amazon.com/dp/${asin}`,
    imageUrl: images[index] ?? images[0] ?? null,
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

/**
 * Attach product URLs to extracted lines that lack them.
 * One Amazon ASIN → apply to every line without a URL (typical single-item order).
 * Multiple ASINs → map by index when counts align.
 */
export function enrichLinesWithProductLinks<
  T extends {
    productUrl?: string | null;
    imageUrl?: string | null;
  },
>(lines: T[], hints: ProductLinkHint[]): T[] {
  if (hints.length === 0) return lines;
  return lines.map((line, index) => {
    if (line.productUrl) return line;
    const hint =
      hints.length === lines.length
        ? hints[index]
        : hints.length === 1
          ? hints[0]
          : hints[index] ?? null;
    if (!hint) return line;
    return {
      ...line,
      productUrl: hint.productUrl,
      imageUrl: line.imageUrl ?? hint.imageUrl ?? null,
    };
  });
}
