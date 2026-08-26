/**
 * BoardGameGeek XML API 2 — free, no key, and the canonical id space for
 * board games the way ISBN is for books.
 *
 * BGG answers XML. Rather than take on a parser dependency for four fields,
 * this reads the handful of documented shapes with targeted patterns; the
 * fixtures in bgg.test.ts mirror real API responses.
 */
import { ProviderError, type ProviderFailure } from '@/lib/books/providers/http';
import type { GameEditionCandidate } from '@/lib/games/types';

const BASE_URL = 'https://boardgamegeek.com/xmlapi2';
/** Same API, different edge. Tried when the primary host refuses us. */
const MIRROR_URL = 'https://api.geekdo.com/xmlapi2';

/**
 * BGG sits behind bot protection that rejects a bare runtime User-Agent —
 * which is exactly what a serverless function sends by default.
 */
const USER_AGENT =
  'ShoppingManager/1.0 (personal inventory tool; +https://github.com/knightx4/ShoppingManager)';

/** BGG answers 202 while it builds a response; the docs say retry. */
const QUEUE_RETRY_DELAYS_MS = [1200, 2500];

export type BggThing = {
  bggId: number;
  title: string;
  yearPublished: number | null;
  publisher: string | null;
  minPlayers: number | null;
  maxPlayers: number | null;
  playingTimeMinutes: number | null;
  imageUrl: string | null;
};

export type BggSearchHit = {
  bggId: number;
  title: string;
  yearPublished: number | null;
};

/** value="…" of the first matching element. */
function attrValue(xml: string, pattern: RegExp): string | null {
  const match = xml.match(pattern);
  return match?.[1]?.trim() || null;
}

function intOrNull(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

export function parseSearchXml(xml: string): BggSearchHit[] {
  const hits: BggSearchHit[] = [];
  for (const block of xml.matchAll(/<item\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/item>/g)) {
    const id = Number(block[1]);
    const body = block[2] ?? '';
    const title = attrValue(body, /<name\b[^>]*type="primary"[^>]*value="([^"]*)"/);
    if (!id || !title) continue;
    hits.push({
      bggId: id,
      title: decodeXmlEntities(title),
      yearPublished: intOrNull(attrValue(body, /<yearpublished\b[^>]*value="([^"]*)"/)),
    });
  }
  return hits;
}

export function parseThingXml(xml: string): BggThing | null {
  const match = xml.match(/<item\b[^>]*\bid="(\d+)"[^>]*>([\s\S]*?)<\/item>/);
  if (!match) return null;
  const bggId = Number(match[1]);
  const body = match[2] ?? '';

  const title =
    attrValue(body, /<name\b[^>]*type="primary"[^>]*value="([^"]*)"/) ??
    attrValue(body, /<name\b[^>]*value="([^"]*)"/);
  if (!bggId || !title) return null;

  const image = body.match(/<image>([\s\S]*?)<\/image>/)?.[1]?.trim() ?? null;
  const thumbnail = body.match(/<thumbnail>([\s\S]*?)<\/thumbnail>/)?.[1]?.trim() ?? null;
  const publisher = attrValue(
    body,
    /<link\b[^>]*type="boardgamepublisher"[^>]*value="([^"]*)"/,
  );

  return {
    bggId,
    title: decodeXmlEntities(title),
    yearPublished: intOrNull(attrValue(body, /<yearpublished\b[^>]*value="([^"]*)"/)),
    publisher: publisher ? decodeXmlEntities(publisher) : null,
    minPlayers: intOrNull(attrValue(body, /<minplayers\b[^>]*value="([^"]*)"/)),
    maxPlayers: intOrNull(attrValue(body, /<maxplayers\b[^>]*value="([^"]*)"/)),
    playingTimeMinutes: intOrNull(attrValue(body, /<playingtime\b[^>]*value="([^"]*)"/)),
    imageUrl: image ?? thumbnail,
  };
}

export function thingToCandidate(thing: BggThing): GameEditionCandidate {
  return {
    bggId: thing.bggId,
    title: thing.title,
    yearPublished: thing.yearPublished,
    publisher: thing.publisher,
    imageUrl: thing.imageUrl,
    source: 'bgg',
  };
}

export type BggOptions = {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
};

/**
 * BGG serves XML, so this goes around getJson but keeps the same failure
 * contract: null for a genuine miss, ProviderError for anything else.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOnce(
  url: string,
  options: BggOptions,
): Promise<{ xml: string | null } | { failure: ProviderFailure }> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetchFn(url, {
      headers: {
        Accept: 'application/xml, text/xml;q=0.9, */*;q=0.8',
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });
    if (res.status === 404) return { xml: null };
    if (res.status === 202) {
      return { failure: { provider: 'bgg', kind: 'unavailable', status: 202 } };
    }
    if (!res.ok) {
      return {
        failure: {
          provider: 'bgg',
          kind:
            res.status === 429
              ? 'rate_limited'
              : res.status === 401 || res.status === 403
                ? 'unauthorized'
                : 'unavailable',
          status: res.status,
        },
      };
    }
    return { xml: await res.text() };
  } catch {
    return {
      failure: {
        provider: 'bgg',
        kind: controller.signal.aborted ? 'timeout' : 'unavailable',
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * BGG serves XML, so this goes around getJson but keeps the same failure
 * contract: null for a genuine miss, ProviderError for anything else. A 202
 * (queued) is retried, and a refusal from the main host is retried once
 * against the mirror before giving up.
 */
async function getXml(
  path: string,
  options: BggOptions,
  hosts: string[],
): Promise<string | null> {
  let lastFailure: ProviderFailure = { provider: 'bgg', kind: 'unavailable' };

  for (const host of hosts) {
    for (let attempt = 0; attempt <= QUEUE_RETRY_DELAYS_MS.length; attempt++) {
      if (attempt > 0) await sleep(QUEUE_RETRY_DELAYS_MS[attempt - 1] ?? 0);
      const result = await fetchOnce(`${host}${path}`, options);
      if ('xml' in result) return result.xml;

      lastFailure = result.failure;
      // 202 and 429 are worth waiting out; a 403 will not change on retry.
      const retryable =
        result.failure.status === 202 ||
        result.failure.kind === 'rate_limited' ||
        result.failure.kind === 'timeout' ||
        (result.failure.status ?? 500) >= 500;
      if (!retryable) break;
    }
  }

  throw new ProviderError(lastFailure);
}

export function createBggProvider(options: BggOptions = {}) {
  const hosts = options.baseUrl ? [options.baseUrl] : [BASE_URL, MIRROR_URL];

  return {
    async searchByTitle(title: string): Promise<BggSearchHit[]> {
      const path = `/search?query=${encodeURIComponent(
        title,
      )}&type=boardgame,boardgameexpansion`;
      const xml = await getXml(path, options, hosts);
      return xml ? parseSearchXml(xml) : [];
    },

    async thing(bggId: number): Promise<BggThing | null> {
      const xml = await getXml(`/thing?id=${bggId}`, options, hosts);
      return xml ? parseThingXml(xml) : null;
    },
  };
}
