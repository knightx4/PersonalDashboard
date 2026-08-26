/**
 * Wikidata as a board-game catalog.
 *
 * BoardGameGeek refuses requests from datacenter IPs — a deployed app gets
 * 401/403 no matter what headers it sends, which is not something the client
 * can fix. Wikidata is an open API that welcomes server traffic, and crucially
 * it stores the BoardGameGeek id (property P2339), so a match here still ends
 * up with the same canonical id BGG would have given us.
 */
import { getJson } from '@/lib/books/providers/http';

const API_URL = 'https://www.wikidata.org/w/api.php';

/** Wikidata asks API users to identify themselves. */
const USER_AGENT =
  'ShoppingManager/1.0 (personal inventory tool; +https://github.com/knightx4/ShoppingManager)';

/** instance-of values that mean "this is a game we care about". */
const GAME_CLASSES = new Set([
  'Q131436', // board game
  'Q11410', // game
  'Q142714', // card game
  'Q3244175', // tabletop game
  'Q1643932', // party game
]);

const PROP_INSTANCE_OF = 'P31';
const PROP_BGG_ID = 'P2339';
const PROP_PUBLISHER = 'P123';
const PROP_PUBLICATION_DATE = 'P577';
const PROP_IMAGE = 'P18';

export type WikidataGame = {
  wikidataId: string;
  title: string;
  bggId: number | null;
  yearPublished: number | null;
  publisherId: string | null;
  imageUrl: string | null;
};

type SearchResponse = {
  search?: { id?: string; label?: string; description?: string }[];
};

type Snak = {
  mainsnak?: {
    datavalue?: {
      value?: unknown;
    };
  };
};

type EntitiesResponse = {
  entities?: Record<
    string,
    {
      id?: string;
      labels?: Record<string, { value?: string }>;
      claims?: Record<string, Snak[]>;
    }
  >;
};

function claimStrings(claims: Record<string, Snak[]> | undefined, prop: string): string[] {
  return (claims?.[prop] ?? [])
    .map((snak) => snak.mainsnak?.datavalue?.value)
    .filter((value): value is string => typeof value === 'string');
}

function claimEntityIds(claims: Record<string, Snak[]> | undefined, prop: string): string[] {
  return (claims?.[prop] ?? [])
    .map((snak) => snak.mainsnak?.datavalue?.value)
    .map((value) =>
      value && typeof value === 'object' && 'id' in value
        ? String((value as { id: unknown }).id)
        : null,
    )
    .filter((id): id is string => Boolean(id));
}

function claimYear(claims: Record<string, Snak[]> | undefined, prop: string): number | null {
  for (const snak of claims?.[prop] ?? []) {
    const value = snak.mainsnak?.datavalue?.value;
    if (value && typeof value === 'object' && 'time' in value) {
      const match = String((value as { time: unknown }).time).match(/(\d{4})/);
      if (match) {
        const year = Number(match[1]);
        if (year >= 1000 && year <= 2100) return year;
      }
    }
  }
  return null;
}

function commonsImageUrl(filename: string): string {
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    filename,
  )}?width=400`;
}

export type WikidataOptions = {
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
};

function request(options: WikidataOptions) {
  return {
    provider: 'wikidata',
    fetch: options.fetch,
    headers: { 'User-Agent': USER_AGENT },
  } as const;
}

export function createWikidataProvider(options: WikidataOptions = {}) {
  const baseUrl = options.baseUrl ?? API_URL;

  return {
    /**
     * Title → game entities. Two round trips whatever the result count:
     * one search, one batched entity fetch, then one more for publisher names.
     */
    async searchGames(title: string): Promise<WikidataGame[]> {
      const searchUrl = `${baseUrl}?action=wbsearchentities&search=${encodeURIComponent(
        title,
      )}&language=en&uselang=en&type=item&limit=7&format=json&origin=*`;
      const found = await getJson<SearchResponse>(searchUrl, request(options));

      const ids = (found?.search ?? [])
        .map((entry) => entry.id)
        .filter((id): id is string => Boolean(id))
        .slice(0, 7);
      if (ids.length === 0) return [];

      const entitiesUrl = `${baseUrl}?action=wbgetentities&ids=${ids.join(
        '|',
      )}&props=claims|labels&languages=en&format=json&origin=*`;
      const entities = await getJson<EntitiesResponse>(entitiesUrl, request(options));

      const games: WikidataGame[] = [];
      for (const id of ids) {
        const entity = entities?.entities?.[id];
        if (!entity) continue;
        const claims = entity.claims;

        const bggRaw = claimStrings(claims, PROP_BGG_ID)[0] ?? null;
        const isGameClass = claimEntityIds(claims, PROP_INSTANCE_OF).some((klass) =>
          GAME_CLASSES.has(klass),
        );
        // A BGG id is itself proof this entity is a board game.
        if (!bggRaw && !isGameClass) continue;

        const label = entity.labels?.en?.value?.trim();
        if (!label) continue;

        const image = claimStrings(claims, PROP_IMAGE)[0] ?? null;
        games.push({
          wikidataId: id,
          title: label,
          bggId: bggRaw && /^\d+$/.test(bggRaw) ? Number(bggRaw) : null,
          yearPublished: claimYear(claims, PROP_PUBLICATION_DATE),
          publisherId: claimEntityIds(claims, PROP_PUBLISHER)[0] ?? null,
          imageUrl: image ? commonsImageUrl(image) : null,
        });
      }
      return games;
    },

    /** Publisher items are ids; one batched call turns them into names. */
    async publisherNames(ids: string[]): Promise<Map<string, string>> {
      const unique = [...new Set(ids)].slice(0, 50);
      if (unique.length === 0) return new Map();
      const url = `${baseUrl}?action=wbgetentities&ids=${unique.join(
        '|',
      )}&props=labels&languages=en&format=json&origin=*`;
      const data = await getJson<EntitiesResponse>(url, request(options));
      const names = new Map<string, string>();
      for (const id of unique) {
        const label = data?.entities?.[id]?.labels?.en?.value?.trim();
        if (label) names.set(id, label);
      }
      return names;
    },
  };
}
