import { z } from 'zod';
import type { FigureKind } from '../types';
import { kilometresBetween, placeQuery } from '../places';
import { MapView, type MapData, type MapPlace } from './map-view';

/**
 * A map of the places a case names (plan #2321.6): a city's districts, its
 * landmarks, the sites a story moves through. The writer names the area and
 * up to ten places, each with a one-line note and, where the case moves
 * through time, a year; `resolve` locates them with the geocoder
 * (`../places.ts`) on the server. The writer never gives coordinates: a spec
 * that carries them has them stripped by the schema.
 *
 * A place the geocoder cannot find, or finds more than MAX_KM from the area,
 * is left off the map and named under it, so a name that matched somewhere
 * else entirely never draws in the wrong city.
 */

/** A place further than this from the area's own centre is taken as a wrong match. */
export const MAX_KM = 120;

const place = z.object({
  name: z.string().trim().min(2).max(80),
  note: z.string().trim().min(2).max(160),
  year: z.number().int().min(1000).max(2100).nullish(),
});

const mapSpec = z.object({
  area: z.string().trim().min(2).max(80),
  places: z.array(place).min(1).max(10),
});

export type MapSpec = z.infer<typeof mapSpec>;

/**
 * The Big Dig in Boston, located by Nominatim on 18 October 2026. The
 * O'Neill tunnel itself is not a named place in OpenStreetMap, so the case
 * marks the old elevated artery at its north end instead.
 */
const BOSTON: MapPlace[] = [
  {
    name: 'Central Artery',
    note: 'The elevated highway opened through downtown and cut the North End off from the rest of the city.',
    year: 1959,
    lat: 42.36247,
    lon: -71.05467,
    url: 'https://www.openstreetmap.org/node/7738417275',
  },
  {
    name: 'Ted Williams Tunnel',
    note: 'The first piece of the Big Dig to open: a road tunnel under the harbour to the airport.',
    year: 1995,
    lat: 42.35619,
    lon: -71.02705,
    url: 'https://www.openstreetmap.org/way/1282504471',
  },
  {
    name: 'Leonard P. Zakim Bunker Hill Memorial Bridge',
    note: 'Carries the new underground highway out over the Charles River.',
    year: 2003,
    lat: 42.3686,
    lon: -71.06296,
    url: 'https://www.openstreetmap.org/way/508557869',
  },
  {
    name: 'Rose Kennedy Greenway',
    note: 'A mile and a half of parks on the land the elevated highway had covered.',
    year: 2008,
    lat: 42.35434,
    lon: -71.05292,
    url: 'https://www.openstreetmap.org/way/94482756',
  },
  {
    name: 'Logan International Airport',
    note: 'The airport the harbour tunnel was built to reach without crossing downtown.',
    year: null,
    lat: 42.36318,
    lon: -71.01364,
    url: 'https://www.openstreetmap.org/way/291828579',
  },
];

export const mapKind: FigureKind<MapSpec, MapData> = {
  id: 'map',
  label: 'Map',
  schema: mapSpec,
  writerLine: `map: a map of the real places a case is about, for an idea that happens somewhere particular, such as a city's districts, the sites a story moves through or where an industry sits. The places are located by a geocoder, never by you: give no coordinates, and name each place as a map would label it ("Faneuil Hall", "Huaqiangbei"), not as a description. spec is {"area": the city or region with its state or country ("Boston, Massachusetts", "Shenzhen, Guangdong"), "places": [1 to 10 of {"name": the place's name, "note": one sentence on why it matters to the lesson, "year": the year it matters, only when the case moves through time}]}. Give years to all the dated places or to none; with two or more years the reader steps through them on a slider.`,
  example: {
    caption: 'The Big Dig in Boston: the elevated highway of 1959 and what replaced it, from the harbour tunnel to the parks.',
    spec: {
      area: 'Boston, Massachusetts',
      places: BOSTON.map(({ name, note, year }) => ({ name, note, year })),
    },
    resolved: { area: 'Boston, Massachusetts', places: BOSTON, missing: [] },
  },
  async resolve(spec, context) {
    const centre = await context.places(placeQuery('', spec.area));
    if (!centre) return null;
    const located = await Promise.all(spec.places.map((one) => context.places(placeQuery(one.name, spec.area))));
    const places: MapPlace[] = [];
    const missing: string[] = [];
    spec.places.forEach((one, index) => {
      const point = located[index];
      if (!point || kilometresBetween(centre, point) > MAX_KM) missing.push(one.name);
      else places.push({ name: one.name, note: one.note, year: one.year ?? null, lat: point.lat, lon: point.lon, url: point.url });
    });
    return places.length > 0 ? { area: spec.area, places, missing } : null;
  },
  Render: ({ resolved }) => <MapView data={resolved} />,
  data: 'places',
};
