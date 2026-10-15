import { geoPath, type GeoProjection } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import countries50 from 'world-atlas/countries-50m.json';
import countries110 from 'world-atlas/countries-110m.json';
import usStates from 'us-atlas/states-10m.json';
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  fitFrame,
  placeDots,
  positionOf,
  projectionOf,
  routePath,
  worldFrame,
  type MapFrame,
  type PlacesMapDrawing,
} from './places-map';
import type { Place } from './places';

/**
 * The Places map's outlines (plan #2091.4), drawn on the server from the
 * country and US state outlines bundled with the app (world-atlas and
 * us-atlas, Natural Earth and Census data), so nothing is asked of an
 * outside service (decision #2091.1). Only the part inside the view is sent:
 * the paths are clipped to the frame, and a wide view uses the coarser
 * outlines.
 *
 * Kept apart from lib/you/places-map.ts because the outlines are about a
 * megabyte of data, which the client map must never import.
 */

type Countries = Topology<{ countries: GeometryCollection }>;
type States = Topology<{ states: GeometryCollection }>;

/** Wider than this many degrees of longitude, the 1:110m outlines are plenty. */
const FINE_SPAN = 60;

type Outlines = { land: GeoJSON.FeatureCollection; borders: GeoJSON.MultiLineString };
const cache = new Map<string, Outlines>();

function outlines(fine: boolean): Outlines {
  const key = fine ? '50m' : '110m';
  const kept = cache.get(key);
  if (kept) return kept;
  const world = (fine ? countries50 : countries110) as unknown as Countries;
  const made: Outlines = {
    land: feature(world, world.objects.countries) as GeoJSON.FeatureCollection,
    borders: mesh(world, world.objects.countries, (a, b) => a !== b),
  };
  cache.set(key, made);
  return made;
}

let stateBorders: GeoJSON.MultiLineString | null = null;
function statesMesh(): GeoJSON.MultiLineString {
  if (!stateBorders) {
    const us = usStates as unknown as States;
    stateBorders = mesh(us, us.objects.states, (a, b) => a !== b);
  }
  return stateBorders;
}

/** How many degrees of longitude the view spans. */
function lonSpan(projection: GeoProjection, width: number, height: number): number {
  const west = projection.invert?.([0, height / 2]);
  const east = projection.invert?.([width, height / 2]);
  if (!west || !east) return 360;
  const span = east[0] - west[0];
  return span <= 0 ? span + 360 : span;
}

/**
 * The map for these places, or null when none has a position. The frame
 * fits the positioned ones; the rest are listed under the map.
 */
export function drawPlacesMap(places: readonly Place[]): PlacesMapDrawing | null {
  const positioned = places.filter((place) => positionOf(place));
  if (positioned.length === 0) return null;
  return drawFrame(
    fitFrame(positioned.map((place) => positionOf(place)!)),
    positioned,
  );
}

/**
 * The map on one place's page (plan #2091.5), with that place's dot alone.
 * It shows the place's own region when it has a position, or else the
 * region of their other places, so a press to place it lands near where
 * they have lived. With neither the drawing is null, and the page draws
 * the whole world only once Set on map is pressed, since its outlines are
 * large.
 */
export function drawPlaceMap(place: Place, places: readonly Place[]): { drawing: PlacesMapDrawing | null } {
  const own = positionOf(place);
  const others = places
    .filter((other) => other.id !== place.id)
    .map(positionOf)
    .filter((at): at is [number, number] => at !== null);
  const points = own ? [own] : others;
  if (points.length === 0) return { drawing: null };
  return { drawing: drawFrame(fitFrame(points), own ? [place] : []) };
}

/** The whole world, with no dots, for setting a place outside the region the place page shows. */
export function drawWorldMap(): PlacesMapDrawing {
  return drawFrame(worldFrame(), [], false);
}

/** The outlines, dots and line for one frame. `withStates` leaves the US state borders off a world view. */
function drawFrame(frame: MapFrame, places: readonly Place[], withStates = true): PlacesMapDrawing {
  const width = MAP_WIDTH;
  const height = MAP_HEIGHT;
  // Clipped a little outside the view, so no outline's edge shows at the frame.
  const projection = projectionOf(frame).clipExtent([
    [-4, -4],
    [width + 4, height + 4],
  ]);
  const path = geoPath(projection).digits(1);
  const world = outlines(lonSpan(projection, width, height) < FINE_SPAN);
  const dots = placeDots(places, projectionOf(frame));

  return {
    width,
    height,
    frame,
    land: path(world.land) ?? '',
    borders: path(world.borders) ?? '',
    states: withStates ? (path(statesMesh()) ?? '') : '',
    route: routePath(dots),
    dots,
  };
}
