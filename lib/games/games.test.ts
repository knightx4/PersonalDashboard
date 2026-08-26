import { describe, expect, it } from 'vitest';
import { classifyScannedCode, isValidEan13, upcToEan13 } from '@/lib/barcodes/scan-code';
import { cleanGameTitle, normalizeForCompare } from '@/lib/games/clean-title';
import { parseSearchXml, parseThingXml } from '@/lib/games/providers/bgg';
import { resolveGameDetailed } from '@/lib/games/resolve';

const SEARCH_XML = `<?xml version="1.0" encoding="utf-8"?>
<items total="3">
  <item type="boardgame" id="266192">
    <name type="primary" value="Wingspan"/>
    <yearpublished value="2019"/>
  </item>
  <item type="boardgameexpansion" id="290448">
    <name type="primary" value="Wingspan: European Expansion"/>
    <yearpublished value="2019"/>
  </item>
  <item type="boardgame" id="999999">
    <name type="primary" value="Wingspan Asia"/>
    <yearpublished value="2022"/>
  </item>
</items>`;

const THING_XML = `<?xml version="1.0" encoding="utf-8"?>
<items>
  <item type="boardgame" id="266192">
    <thumbnail>https://cf.geekdo-images.com/thumb.jpg</thumbnail>
    <image>https://cf.geekdo-images.com/original.jpg</image>
    <name type="primary" sortindex="1" value="Wingspan"/>
    <name type="alternate" sortindex="1" value="Flügelschlag"/>
    <yearpublished value="2019"/>
    <minplayers value="1"/>
    <maxplayers value="5"/>
    <playingtime value="70"/>
    <link type="boardgamepublisher" id="34188" value="Stonemaier Games"/>
    <link type="boardgamecategory" id="1089" value="Animals"/>
  </item>
</items>`;

describe('barcode classification', () => {
  it('validates EAN-13 check digits', () => {
    expect(isValidEan13('0810011725195')).toBe(true);
    expect(isValidEan13('0810011725196')).toBe(false);
  });

  it('pads UPC-A to EAN-13', () => {
    expect(upcToEan13('810011725195')).toBe('0810011725195');
  });

  it('routes Bookland codes to the book path and others to products', () => {
    expect(classifyScannedCode('9780735211292')).toEqual({
      kind: 'isbn',
      isbn13: '9780735211292',
    });
    expect(classifyScannedCode('810011725195')).toEqual({
      kind: 'product',
      ean13: '0810011725195',
      upc12: '810011725195',
    });
    expect(classifyScannedCode('12345')).toBeNull();
  });
});

describe('BGG XML parsing', () => {
  it('reads search hits', () => {
    const hits = parseSearchXml(SEARCH_XML);
    expect(hits).toHaveLength(3);
    expect(hits[0]).toEqual({ bggId: 266192, title: 'Wingspan', yearPublished: 2019 });
    expect(hits[1]?.title).toBe('Wingspan: European Expansion');
  });

  it('reads a thing, preferring the primary name and full image', () => {
    const thing = parseThingXml(THING_XML);
    expect(thing).toMatchObject({
      bggId: 266192,
      title: 'Wingspan',
      yearPublished: 2019,
      publisher: 'Stonemaier Games',
      minPlayers: 1,
      maxPlayers: 5,
      playingTimeMinutes: 70,
      imageUrl: 'https://cf.geekdo-images.com/original.jpg',
    });
  });

  it('decodes XML entities in titles', () => {
    const xml = THING_XML.replace('value="Wingspan"', 'value="Ticket to Ride &amp; Friends"');
    expect(parseThingXml(xml)?.title).toBe('Ticket to Ride & Friends');
  });
});

describe('cleanGameTitle', () => {
  it('strips retail packaging noise', () => {
    expect(cleanGameTitle('Stonemaier Games Wingspan Board Game, Ages 14+, 1-5 Players')).toBe(
      'Wingspan',
    );
    expect(cleanGameTitle('Hasbro Gaming Monopoly Mega Edition')).toBe('Monopoly Mega Edition');
  });

  it('keeps expansions distinguishable', () => {
    expect(normalizeForCompare('Catan Expansion: Seafarers')).toBe('catan seafarers');
    expect(normalizeForCompare('Catan: Seafarers')).toBe('catan seafarers');
    expect(normalizeForCompare('Catan')).not.toBe(normalizeForCompare('Catan: Seafarers'));
  });
});

const WIKIDATA_SEARCH = JSON.stringify({
  search: [{ id: 'Q56320855', label: 'Wingspan', description: 'board game' }],
});

const WIKIDATA_ENTITIES = JSON.stringify({
  entities: {
    Q56320855: {
      id: 'Q56320855',
      labels: { en: { value: 'Wingspan' } },
      claims: {
        P31: [{ mainsnak: { datavalue: { value: { id: 'Q131436' } } } }],
        P2339: [{ mainsnak: { datavalue: { value: '266192' } } }],
        P577: [{ mainsnak: { datavalue: { value: { time: '+2019-00-00T00:00:00Z' } } } }],
        P123: [{ mainsnak: { datavalue: { value: { id: 'Q61080557' } } } }],
      },
    },
  },
});

const WIKIDATA_PUBLISHER = JSON.stringify({
  entities: { Q61080557: { labels: { en: { value: 'Stonemaier Games' } } } },
});

describe('wikidata fallback', () => {
  const wikidataFetch: typeof fetch = async (input) => {
    const url = String(input);
    // BGG refuses this host, exactly as it does from a deployed server.
    if (url.includes('bgg.test')) return new Response('nope', { status: 401 });
    if (url.includes('wbsearchentities')) return new Response(WIKIDATA_SEARCH, { status: 200 });
    if (url.includes('props=labels&')) return new Response(WIKIDATA_PUBLISHER, { status: 200 });
    if (url.includes('wbgetentities')) return new Response(WIKIDATA_ENTITIES, { status: 200 });
    return new Response('unexpected', { status: 500 });
  };

  it('resolves through Wikidata when BoardGameGeek refuses, keeping the BGG id', async () => {
    const outcome = await resolveGameDetailed(
      { title: 'Wingspan' },
      {
        fetch: wikidataFetch,
        bggBaseUrl: 'https://bgg.test',
        wikidataBaseUrl: 'https://wikidata.test/w/api.php',
      },
    );
    expect(outcome.game?.title).toBe('Wingspan');
    expect(outcome.game?.bggId).toBe(266192);
    expect(outcome.game?.wikidataId).toBe('Q56320855');
    expect(outcome.game?.publisher).toBe('Stonemaier Games');
    expect(outcome.game?.yearPublished).toBe(2019);
    expect(outcome.game?.resolutionSource).toBe('wikidata');
    // The BGG refusal is still reported, even though the lookup recovered.
    expect(outcome.failures.some((f) => f.provider === 'bgg')).toBe(true);
  });

  it('skips entities that are not games', async () => {
    const notAGame: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('bgg.test')) return new Response('nope', { status: 401 });
      if (url.includes('wbsearchentities')) {
        return new Response(
          JSON.stringify({ search: [{ id: 'Q1', label: 'Wingspan', description: 'album' }] }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          entities: {
            Q1: {
              id: 'Q1',
              labels: { en: { value: 'Wingspan' } },
              claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q482994' } } } }] },
            },
          },
        }),
        { status: 200 },
      );
    };
    const outcome = await resolveGameDetailed(
      { title: 'Wingspan' },
      {
        fetch: notAGame,
        bggBaseUrl: 'https://bgg.test',
        wikidataBaseUrl: 'https://wikidata.test/w/api.php',
      },
    );
    expect(outcome.game).toBeNull();
  });
});

describe('resolveGameDetailed', () => {
  const bggFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.includes('/search')) return new Response(SEARCH_XML, { status: 200 });
    if (url.includes('/thing')) return new Response(THING_XML, { status: 200 });
    return new Response('unexpected', { status: 500 });
  };

  it('resolves a title to a BGG entry with alternates', async () => {
    const outcome = await resolveGameDetailed(
      { title: 'Wingspan' },
      { fetch: bggFetch, bggBaseUrl: 'https://bgg.test' },
    );
    expect(outcome.game?.bggId).toBe(266192);
    expect(outcome.game?.publisher).toBe('Stonemaier Games');
    expect(outcome.failures).toEqual([]);
  });

  it('reports a rate-limited catalog rather than a miss', async () => {
    const limited: typeof fetch = async () => new Response('slow down', { status: 429 });
    const outcome = await resolveGameDetailed(
      { title: 'Wingspan' },
      {
        fetch: limited,
        bggBaseUrl: 'https://bgg.test',
        wikidataBaseUrl: 'https://wikidata.test/w/api.php',
      },
    );
    expect(outcome.game).toBeNull();
    expect(outcome.failures.map((f) => f.kind)).toContain('rate_limited');
  });

  it('takes a barcode through the UPC lookup before BGG', async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('upcitemdb')) {
        return new Response(
          JSON.stringify({
            code: 'OK',
            items: [{ title: 'Stonemaier Games Wingspan Board Game, Ages 14+', brand: 'Stonemaier' }],
          }),
          { status: 200 },
        );
      }
      return bggFetch(input as string, undefined);
    };
    const outcome = await resolveGameDetailed(
      { barcode: '810011725195' },
      { fetch: fetchFn, bggBaseUrl: 'https://bgg.test', upcBaseUrl: 'https://upcitemdb.test' },
    );
    expect(outcome.productTitle).toContain('Wingspan');
    expect(outcome.game?.bggId).toBe(266192);
    expect(outcome.game?.barcode).toBe('0810011725195');
    // Barcode → product-name → BGG is a two-hop guess; always worth a look.
    expect(outcome.game?.needsConfirmation).toBe(true);
  });
});
