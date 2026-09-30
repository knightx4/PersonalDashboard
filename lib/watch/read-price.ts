/**
 * Fetch a watched page and read its lowest price (plan #1292).
 *
 * Never throws. Every failure (a bad or private URL, a timeout, a non-200, a
 * page with no price) comes back as `{ ok: false, error }`, in words the
 * person can read, so the hourly run writes it as an error reading rather
 * than going quiet or recording a zero.
 *
 * The URL guard is lib/saved/scrape-product.ts's, applied again to every
 * redirect hop so a public page cannot bounce the fetch onto a private host.
 */
import 'server-only';

import { assertPublicUrl, ScrapeUrlError } from '@/lib/saved/scrape-product';
import { parsePriceHtml, type ParsePriceOptions, type PriceReading } from '@/lib/watch/parse-price';

export type { PriceReading, PriceDetail, PriceListing, ParsePriceOptions } from '@/lib/watch/parse-price';
export { parsePriceHtml } from '@/lib/watch/parse-price';

const FETCH_TIMEOUT_MS = 10_000;
/** Resale pages carry their data inline; CrowdVolt's was 311 KB on 30 Sep 2026. */
const MAX_BODY_BYTES = 3_000_000;
const MAX_REDIRECTS = 5;

/** Browsers get the full page; some resale sites serve bots a stub. */
const USER_AGENT =
  'Mozilla/5.0 (compatible; DashWatch/1.0; +https://github.com/knightx4/ShoppingManager)';

export async function readLowestPrice(
  rawUrl: string,
  options: ParsePriceOptions = {},
): Promise<PriceReading> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let url = await assertPublicUrl(rawUrl.trim());
    let response: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      response = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          'User-Agent': USER_AGENT,
        },
      });
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) break;
      if (hop === MAX_REDIRECTS) return fail('The page redirected too many times.');
      url = await assertPublicUrl(new URL(location, url).toString());
    }

    if (!response || !response.ok) {
      return fail(`The page answered ${response?.status ?? 'nothing'} instead of loading.`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return fail('The link is not a web page.');
    }

    const html = await readCapped(response, controller);
    if (html == null) return fail('The page is too large to read.');
    return parsePriceHtml(html, url.toString(), options);
  } catch (error) {
    if (error instanceof ScrapeUrlError) return fail(error.message);
    if (controller.signal.aborted) return fail('The page took too long to load.');
    return fail('The page could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}

function fail(error: string): PriceReading {
  return { ok: false, error };
}

async function readCapped(response: Response, controller: AbortController): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      controller.abort();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}
