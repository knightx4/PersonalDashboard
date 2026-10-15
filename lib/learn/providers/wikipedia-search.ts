import 'server-only';

import { z } from 'zod';
import { fetchDocument } from './fetch';
import { RATE_LIMIT_WAITS_MS } from './wikipedia';

/**
 * Wikipedia's own search, for proposing a subject's articles (plan #2157.1).
 * One request per idea name; the top hit in the main namespace is the article
 * proposed. Nothing here asks a model.
 */

const API_ENDPOINT = 'https://en.wikipedia.org/w/api.php';

export function searchRequestUrl(query: string): string {
  const url = new URL(API_ENDPOINT);
  url.searchParams.set('action', 'query');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  url.searchParams.set('list', 'search');
  url.searchParams.set('srnamespace', '0');
  url.searchParams.set('srlimit', '1');
  url.searchParams.set('srprop', '');
  url.searchParams.set('srsearch', query);
  return url.toString();
}

export type WikipediaSearchResult =
  | { ok: true; title: string | null }
  | { ok: false; detail: string };

/** Reads the top hit out of a search answer; null when nothing matched. */
export function parseSearchResponse(body: string): WikipediaSearchResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, detail: 'Wikipedia answered with something that is not JSON.' };
  }
  const hits = z
    .object({ query: z.object({ search: z.array(z.object({ title: z.string() })) }) })
    .safeParse(parsed);
  if (!hits.success) return { ok: false, detail: 'Wikipedia answered in a shape this does not read.' };
  return { ok: true, title: hits.data.query.search[0]?.title ?? null };
}

/** A 429 is asked again after a wait, as the article fetch does. */
export async function searchWikipediaTitle(
  query: string,
  options: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<WikipediaSearchResult> {
  const wanted = query.trim();
  if (!wanted) return { ok: true, title: null };
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let fetched = await fetchDocument(searchRequestUrl(wanted));
  for (const wait of RATE_LIMIT_WAITS_MS) {
    if (fetched.ok || fetched.reason !== 'error' || fetched.detail !== '429') break;
    await sleep(wait);
    fetched = await fetchDocument(searchRequestUrl(wanted));
  }
  if (!fetched.ok) return { ok: false, detail: `${fetched.reason}: ${fetched.detail}` };
  if (fetched.contentType !== 'json') return { ok: false, detail: `expected JSON, got ${fetched.contentType}` };
  return parseSearchResponse(fetched.text);
}
