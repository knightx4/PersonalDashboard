import { geoMercator, type GeoProjection } from 'd3-geo';
import { isCurrent, placeSpan, type Place } from './places';

/**
 * The Places tab's map (plan #2091.4): where each place sits, which one is
 * home now, and the line joining them in the order they moved in.
 *
 * Decision #2091.1 keeps the map off outside services, so it is drawn from
 * outlines bundled with the app (lib/you/places-map-outlines.ts) through a
 * Mercator projection fitted to the dots. This file holds the light half:
 * the frame, the dots and the line, with no outline data, so the client map
 * can rebuild the projection from its frame and turn a press back into a
 * position (#2091.5 places a place by hand that way).
 */

/** The drawing's own units; the page scales it to the column's width. */
export const MAP_WIDTH = 960;
export const MAP_HEIGHT = 720;

/** The projection, as numbers a client can rebuild it from. */
export type MapFrame = {
  /** Mercator's scale, in drawing units. */
  scale: number;
  translate: [number, number];
  /** Degrees of longitude the globe is turned by, so the dots sit in the middle. */
  rotate: number;
};

export type MapDot = {
  id: string;
  name: string;
  /** What the dot's tooltip says: the name and the years there. */
  label: string;
  /** Where the dot sits in drawing units, moved off its true spot when several share one. */
  x: number;
  y: number;
  current: boolean;
  /** Which side of the dot its name goes: away from its crowd, or from the nearer edge. */
  labelSide: 'left' | 'right';
};

export type PlacesMapDrawing = {
  width: number;
  height: number;
  frame: MapFrame;
  /** The land, as one filled path. */
  land: string;
  /** The borders between countries. */
  borders: string;
  /** The borders between US states, where the view reaches them; empty on the whole world. */
  states: string;
  /** The line through the dots in move-in order; empty with fewer than two. */
  route: string;
  /** Oldest move first. */
  dots: MapDot[];
};

/** [longitude, latitude], or null for a place not on the map yet. */
export function positionOf(place: Pick<Place, 'latitude' | 'longitude'>): [number, number] | null {
  if (place.latitude === null || place.longitude === null) return null;
  if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return null;
  return [place.longitude, place.latitude];
}

/** The places with a position, and the ones without, each in the order given. */
export function splitByPosition<P extends Pick<Place, 'latitude' | 'longitude'>>(
  places: readonly P[],
): { onMap: P[]; offMap: P[] } {
  const onMap: P[] = [];
  const offMap: P[] = [];
  for (const place of places) (positionOf(place) ? onMap : offMap).push(place);
  return { onMap, offMap };
}

/** Oldest move first, the order the line joins them in. */
export function moveInOrder<P extends Pick<Place, 'movedIn' | 'name'>>(places: readonly P[]): P[] {
  return [...places].sort((a, b) =>
    a.movedIn !== b.movedIn ? (a.movedIn < b.movedIn ? -1 : 1) : a.name.localeCompare(b.name),
  );
}

/** The smallest stretch the view shows, so one place shows its region rather than its street. */
const MIN_LON_SPAN = 14;
const MIN_LAT_SPAN = 9;
/** Room left round the dots, as a share of what they span. */
const MARGIN = 0.25;
const LAT_LIMIT = 80;

/**
 * The frame that fits every position, with room round the edges. The view's
 * shape is fixed, so the dots' longer side sets the zoom.
 */
export function fitFrame(points: readonly [number, number][], width = MAP_WIDTH, height = MAP_HEIGHT): MapFrame {
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  let west = Math.min(...lons);
  let east = Math.max(...lons);
  let south = Math.min(...lats);
  let north = Math.max(...lats);

  const lonPad = Math.max((east - west) * MARGIN, (MIN_LON_SPAN - (east - west)) / 2, 0);
  const latPad = Math.max((north - south) * MARGIN, (MIN_LAT_SPAN - (north - south)) / 2, 0);
  west -= lonPad;
  east += lonPad;
  south = Math.max(-LAT_LIMIT, south - latPad);
  north = Math.min(LAT_LIMIT, north + latPad);

  const centre = (west + east) / 2;
  const projection = geoMercator()
    .rotate([-centre, 0])
    .fitExtent(
      [
        [0, 0],
        [width, height],
      ],
      {
        type: 'MultiPoint',
        coordinates: [
          [west, south],
          [east, north],
          [west, north],
          [east, south],
        ],
      },
    );
  const [tx, ty] = projection.translate();
  return { scale: projection.scale(), translate: [tx, ty], rotate: -centre };
}

/**
 * The whole world, from the Southern Ocean to the Arctic, for placing a
 * place by hand (#2091.5) when nothing else gives the map a region to show.
 */
export function worldFrame(width = MAP_WIDTH, height = MAP_HEIGHT): MapFrame {
  const projection = geoMercator().fitExtent(
    [
      [0, 0],
      [width, height],
    ],
    {
      type: 'MultiPoint',
      coordinates: [
        [-179.9, -58],
        [179.9, 78],
      ],
    },
  );
  const [tx, ty] = projection.translate();
  return { scale: projection.scale(), translate: [tx, ty], rotate: 0 };
}

/**
 * A position a press or a request names, rounded to four places (about ten
 * metres), or null when it is not one: the database holds a latitude from
 * -90 to 90 and a longitude from -180 to 180.
 */
export function checkPosition(value: unknown): { latitude: number; longitude: number } | null {
  if (!value || typeof value !== 'object') return null;
  const { latitude, longitude } = value as Record<string, unknown>;
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const four = (n: number) => Math.round(n * 1e4) / 1e4;
  return { latitude: four(latitude), longitude: four(longitude) };
}

/** The projection a frame names. */
export function projectionOf(frame: MapFrame): GeoProjection {
  return geoMercator().rotate([frame.rotate, 0]).scale(frame.scale).translate(frame.translate);
}

/**
 * The position at a point on the drawing, in drawing units, for a press on
 * the map. Null off the edge of the world.
 */
export function positionAt(frame: MapFrame, x: number, y: number): { latitude: number; longitude: number } | null {
  const position = projectionOf(frame).invert?.([x, y]);
  if (!position) return null;
  const [longitude, latitude] = position;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90) return null;
  return { latitude, longitude: ((((longitude + 180) % 360) + 360) % 360) - 180 };
}

/** Dots closer than this, in drawing units, are drawn as one group fanned round its centre. */
const CROWD = 40;
/** How far a fanned dot sits from its group's centre, in drawing units: about 13 pixels on a phone. */
const FAN_RADIUS = 34;

/**
 * A dot for each positioned place. Places in one city would sit on top of
 * each other with only the top one pressable, so each crowd is drawn round
 * its centre instead, far enough apart to press one on a phone.
 * The dots come back oldest move first, the order the line joins them in.
 */
export function placeDots(
  places: readonly Place[],
  projection: GeoProjection,
  projectionWidth = MAP_WIDTH,
): MapDot[] {
  type Crowd = { x: number; y: number; members: { place: Place; x: number; y: number }[] };
  const crowds: Crowd[] = [];
  const ordered = moveInOrder(places);
  for (const place of ordered) {
    const position = positionOf(place);
    const point = position ? projection(position) : null;
    if (!point) continue;
    const [x, y] = point;
    const crowd = crowds.find((c) => Math.hypot(c.x - x, c.y - y) < CROWD);
    if (crowd) {
      crowd.members.push({ place, x, y });
      crowd.x = crowd.members.reduce((sum, m) => sum + m.x, 0) / crowd.members.length;
      crowd.y = crowd.members.reduce((sum, m) => sum + m.y, 0) / crowd.members.length;
    } else {
      crowds.push({ x, y, members: [{ place, x, y }] });
    }
  }

  const dots = crowds.flatMap((crowd) =>
    crowd.members.map(({ place }, index): MapDot => {
      const n = crowd.members.length;
      // Oldest on the left, so the line into the crowd reaches it before the next.
      const angle = Math.PI + (2 * Math.PI * index) / n;
      return {
        id: place.id,
        name: place.name,
        label: `${place.name}, ${placeSpan(place)}`,
        x: round(crowd.x + (n > 1 ? FAN_RADIUS * Math.cos(angle) : 0)),
        y: round(crowd.y + (n > 1 ? FAN_RADIUS * Math.sin(angle) : 0)),
        current: isCurrent(place),
        labelSide: (n > 1 ? Math.cos(angle) < -0.01 : crowd.x > projectionWidth * 0.65) ? 'left' : 'right',
      };
    }),
  );
  // Back into move-in order, which the line follows.
  const order = new Map(ordered.map((place, index) => [place.id, index]));
  return dots.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * The line through the dots in move-in order, straight from dot to dot as
 * they are drawn, so a fanned dot is on it too.
 */
export function routePath(dots: readonly Pick<MapDot, 'x' | 'y'>[]): string {
  if (dots.length < 2) return '';
  return dots.map((dot, index) => `${index === 0 ? 'M' : 'L'}${dot.x},${dot.y}`).join('');
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
