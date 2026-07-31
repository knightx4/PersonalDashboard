/**
 * Fetch a product URL and run it through the JSON-LD → OG parse ladder.
 * Scrape is enrichment: blocked pages return empty fields, not hard failures,
 * except for clearly invalid / private URLs (SSRF).
 */
import 'server-only';

import { lookup } from 'node:dns/promises';
import {
  emptyScrapedProduct,
  parseProductHtml,
  type ScrapedProduct,
} from '@/lib/saved/parse-product';
import { isBlockedHostname, isPrivateIpAddress } from '@/lib/saved/ssrf';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 1_000_000;

export type { ScrapedProduct };
export { parseProductHtml, parsePriceToCents, scrapedProductSchema } from '@/lib/saved/parse-product';
export { isBlockedHostname } from '@/lib/saved/ssrf';

export class ScrapeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScrapeUrlError';
  }
}

async function assertPublicUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ScrapeUrlError('That does not look like a valid URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ScrapeUrlError('Only http and https product links are supported.');
  }
  if (url.username || url.password) {
    throw new ScrapeUrlError('URLs with credentials are not allowed.');
  }
  if (isBlockedHostname(url.hostname)) {
    throw new ScrapeUrlError('That host cannot be fetched.');
  }

  try {
    const records = await lookup(url.hostname, { all: true, verbatim: true });
    if (records.length === 0) throw new ScrapeUrlError('Could not resolve that host.');
    for (const record of records) {
      const family = record.family === 6 ? 6 : 4;
      if (isPrivateIpAddress(record.address, family)) {
        throw new ScrapeUrlError('That host cannot be fetched.');
      }
    }
  } catch (error) {
    if (error instanceof ScrapeUrlError) throw error;
    throw new ScrapeUrlError('Could not resolve that host.');
  }

  return url;
}

export async function scrapeProductUrl(rawUrl: string): Promise<ScrapedProduct> {
  const url = await assertPublicUrl(rawUrl.trim());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        // Browser-like UA: custom bot strings often get Amazon's generic OG shell.
        'User-Agent':
          'Mozilla/5.0 (compatible; ShoppingManager/1.0; +https://github.com/knightx4/ShoppingManager)',
      },
    });

    if (!response.ok) {
      return emptyScrapedProduct(url.toString());
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return emptyScrapedProduct(url.toString());
    }

    const reader = response.body?.getReader();
    if (!reader) {
      return parseProductHtml('', url.toString());
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        controller.abort();
        break;
      }
      chunks.push(value);
    }

    const html = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    return parseProductHtml(html, url.toString());
  } catch (error) {
    if (error instanceof ScrapeUrlError) throw error;
    return emptyScrapedProduct(url.toString());
  } finally {
    clearTimeout(timer);
  }
}
