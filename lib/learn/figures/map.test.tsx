import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Figure } from '@/components/learn/figure';
import { mapKind } from './kinds/map';
import { HEIGHT, MARKER_GAP, WIDTH, mapFrame, spread } from './kinds/map-frame';
import { placeLoader, placeQuery, type GeoPoint, type Located, type PlaceCache } from './places';
import { readWrittenFigures } from './registry';
import { resolveFigures } from './resolve';
import type { FigureResolveContext } from './types';

const point = (lat: number, lon: number): GeoPoint => ({ lat, lon, displayName: 'x', url: null });

const BOSTON = { lat: 42.35883, lon: -71.05783 };

function context(found: Record<string, GeoPoint | null>): FigureResolveContext {
  return { series: async () => null, places: async (query) => found[query] ?? null };
}

describe('a map figure (plan #2321.6)', () => {
  it('takes no coordinates from the writer', () => {
    const [block] = readWrittenFigures([
      {
        kind: 'map',
        caption: 'Two places in Boston.',
        spec: { area: 'Boston, Massachusetts', places: [{ name: 'Faneuil Hall', note: 'A market.', lat: 1, lon: 2 }] },
      },
    ]);
    expect(block.spec).toEqual({ area: 'Boston, Massachusetts', places: [{ name: 'Faneuil Hall', note: 'A market.' }] });
  });

  it('locates its places through the geocoder and leaves off what it cannot find or finds far away', async () => {
    const [resolved] = await resolveFigures(
      [
        {
          kind: 'map',
          caption: 'Boston.',
          spec: {
            area: 'Boston, Massachusetts',
            places: [
              { name: 'Faneuil Hall', note: 'A market.', year: 1742 },
              { name: 'Nowhere Lane', note: 'Not a place.' },
              { name: 'Back Bay', note: 'Matched in another country.' },
            ],
          },
        },
      ],
      context({
        [placeQuery('', 'Boston, Massachusetts')]: point(BOSTON.lat, BOSTON.lon),
        [placeQuery('Faneuil Hall', 'Boston, Massachusetts')]: point(42.36, -71.056),
        [placeQuery('Back Bay', 'Boston, Massachusetts')]: point(51.5, -0.12),
      }),
    );
    expect(resolved.resolved).toEqual({
      area: 'Boston, Massachusetts',
      places: [{ name: 'Faneuil Hall', note: 'A market.', year: 1742, lat: 42.36, lon: -71.056, url: null }],
      missing: ['Nowhere Lane', 'Back Bay'],
    });
    const html = renderToStaticMarkup(<Figure figure={resolved} />);
    expect(html).toContain('Not found on the map: Nowhere Lane, Back Bay.');
  });

  it('shows its caption alone when the area itself cannot be found', async () => {
    const [resolved] = await resolveFigures([{ kind: 'map', caption: 'Atlantis.', spec: mapKind.example.spec }], context({}));
    expect(resolved.resolved).toBeNull();
    expect(renderToStaticMarkup(<Figure figure={resolved} />)).toContain('The data for this figure was not found.');
  });

  it('draws the place list under the map, and a year slider only for dated places', () => {
    const html = renderToStaticMarkup(<Figure figure={{ kind: 'map', ...mapKind.example }} />);
    expect(html).toContain('<ol');
    for (const place of mapKind.example.resolved!.places) expect(html).toContain(place.note);
    expect(html).toContain('type="range"');

    const undated = {
      ...mapKind.example.resolved!,
      places: mapKind.example.resolved!.places.map((place) => ({ ...place, year: null })),
    };
    const plain = renderToStaticMarkup(<Figure figure={{ kind: 'map', ...mapKind.example, resolved: undated }} />);
    expect(plain).toContain('<ol');
    expect(plain).not.toContain('type="range"');
  });
});

describe('the map frame', () => {
  it('fits every place inside the frame, closer for places close together', () => {
    const near = mapFrame([point(42.36, -71.06), point(42.355, -71.05)]);
    const far = mapFrame([point(42.36, -71.06), point(42.2, -70.8)]);
    expect(near.zoom).toBeGreaterThan(far.zoom);
    for (const { x, y } of [...near.at, ...far.at]) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(WIDTH);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(HEIGHT);
    }
  });

  it('pushes overlapping markers apart and keeps each inside the frame', () => {
    const at = spread([{ x: 300, y: 200 }, { x: 302, y: 201 }, { x: 300, y: 200 }, { x: 5, y: 5 }]);
    for (let i = 0; i < at.length; i++) {
      for (let j = i + 1; j < at.length; j++) {
        expect(Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y)).toBeGreaterThanOrEqual(MARKER_GAP - 1);
      }
      expect(at[i].x).toBeGreaterThan(0);
      expect(at[i].y).toBeGreaterThan(0);
    }
    expect(spread([{ x: 100, y: 100 }, { x: 300, y: 300 }])).toEqual([{ x: 100, y: 100 }, { x: 300, y: 300 }]);
  });

  it('lays tiles over the whole frame', () => {
    const frame = mapFrame([point(42.36, -71.06)]);
    expect(frame.tiles.some((tile) => tile.left <= 0 && tile.top <= 0)).toBe(true);
    expect(frame.tiles.some((tile) => tile.left + 256 >= WIDTH && tile.top + 256 >= HEIGHT)).toBe(true);
  });
});

describe('the place loader', () => {
  function memoryCache(): PlaceCache & { rows: Map<string, Located> } {
    const rows = new Map<string, Located>();
    return { rows, read: async (query) => rows.get(query), write: async (query, located) => void rows.set(query, located) };
  }
  const nominatim = (hits: unknown[]) => {
    const asked: string[] = [];
    const fetchImpl = async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify(hits), { status: 200 });
    };
    return { asked, fetchImpl };
  };

  it('on the page reads the cache and never asks the geocoder', async () => {
    const cache = memoryCache();
    cache.rows.set('faneuil hall, boston', { found: true, point: point(42.36, -71.056) });
    const load = placeLoader({ cache: { read: cache.read } });
    expect(await load('faneuil hall, boston')).toMatchObject({ lat: 42.36 });
    expect(await load('somewhere new, boston')).toBeNull();
  });

  it('for the writer asks once, keeps the answer found or not, and waits between requests', async () => {
    const cache = memoryCache();
    const { asked, fetchImpl } = nominatim([{ lat: '42.36', lon: '-71.056', display_name: 'Faneuil Hall', osm_type: 'way', osm_id: 7 }]);
    const waits: number[] = [];
    const load = placeLoader({ cache, ask: { fetchImpl }, wait: async (ms) => void waits.push(ms) });
    const [first, second] = await Promise.all([load('faneuil hall, boston'), load('old state house, boston')]);
    expect(first).toEqual({ lat: 42.36, lon: -71.056, displayName: 'Faneuil Hall', url: 'https://www.openstreetmap.org/way/7' });
    expect(second).not.toBeNull();
    expect(asked).toHaveLength(2);
    expect(waits).toHaveLength(1);
    await load('faneuil hall, boston');
    expect(asked).toHaveLength(2);

    const none = nominatim([]);
    const missLoad = placeLoader({ cache, ask: { fetchImpl: none.fetchImpl }, wait: async () => {} });
    expect(await missLoad('nowhere lane, boston')).toBeNull();
    expect(cache.rows.get('nowhere lane, boston')).toEqual({ found: false });
  });

  it('keys a place by its name and area, lower-cased', () => {
    expect(placeQuery('  Faneuil   Hall ', 'Boston ,Massachusetts')).toBe('faneuil hall, boston, massachusetts');
    expect(placeQuery('', 'Boston, Massachusetts')).toBe('boston, massachusetts');
  });
});
