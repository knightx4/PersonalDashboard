/**
 * BoardGameGeek XML API 2 — free, no key, and the canonical id space for
 * board games the way ISBN is for books.
 *
 * BGG answers XML. Rather than take on a parser dependency for four fields,
 * this reads the handful of documented shapes with targeted patterns; the
 * fixtures in bgg.test.ts mirror real API responses.
 */
import { ProviderError } from '@/lib/books/providers/http';
import type { GameEditionCandidate } from '@/lib/games/types';

const BASE_URL = 'https://boardgamegeek.com/xmlapi2';

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
async function getXml(url: string, options: BggOptions): Promise<string | null> {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetchFn(url, {
      headers: { Accept: 'application/xml' },
      signal: controller.signal,
    });
    if (res.status === 404) return null;
    // BGG answers 202 while it warms a cached response; that is not a miss.
    if (res.status === 202) {
      throw new ProviderError({ provider: 'bgg', kind: 'unavailable', status: 202 });
    }
    if (!res.ok) {
      throw new ProviderError({
        provider: 'bgg',
        kind: res.status === 429 ? 'rate_limited' : 'unavailable',
        status: res.status,
      });
    }
    return await res.text();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError({
      provider: 'bgg',
      kind: controller.signal.aborted ? 'timeout' : 'unavailable',
    });
  } finally {
    clearTimeout(timer);
  }
}

export function createBggProvider(options: BggOptions = {}) {
  const baseUrl = options.baseUrl ?? BASE_URL;

  return {
    async searchByTitle(title: string): Promise<BggSearchHit[]> {
      const url = `${baseUrl}/search?query=${encodeURIComponent(
        title,
      )}&type=boardgame,boardgameexpansion`;
      const xml = await getXml(url, options);
      return xml ? parseSearchXml(xml) : [];
    },

    async thing(bggId: number): Promise<BggThing | null> {
      const xml = await getXml(`${baseUrl}/thing?id=${bggId}`, options);
      return xml ? parseThingXml(xml) : null;
    },
  };
}
