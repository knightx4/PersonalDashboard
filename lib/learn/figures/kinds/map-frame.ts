import { geoMercator } from 'd3-geo';

/**
 * The frame a map figure is drawn in (plan #2321.6): the zoom that fits its
 * places, where each place falls, and the base tiles under them.
 *
 * The projection is d3-geo's Mercator scaled to the web's tile grid, so a
 * place projects onto the same pixel as the tile drawn under it. Everything
 * is in the frame's own units (WIDTH by HEIGHT); the page draws them as
 * percentages, so the map scales to its column.
 */

export const WIDTH = 640;
export const HEIGHT = 400;
const TILE = 256;
/** Room kept round the places, so a marker at the edge is not cut. */
const PAD = 56;
/** A city's districts at the widest; a single building at the closest. */
const MIN_ZOOM = 3;
const MAX_ZOOM = 15;

export type FramePoint = { lat: number; lon: number };
export type FrameTile = { z: number; x: number; y: number; left: number; top: number };
export type Frame = {
  zoom: number;
  /** Where each point's marker sits, in order: on the point, or pushed clear of a neighbour. */
  at: { x: number; y: number }[];
  /** Where each point truly is; differs from `at` only for a marker that was pushed. */
  true: { x: number; y: number }[];
  tiles: FrameTile[];
};

/**
 * Markers closer than this, in frame units, are pushed apart. A marker is
 * about 24 pixels across and the frame is drawn at 340 pixels wide on a
 * phone, so this keeps each number clear of its neighbour there.
 */
export const MARKER_GAP = 44;

/** Pushes markers apart until none overlaps, keeping each inside the frame. */
export function spread(points: readonly { x: number; y: number }[], gap = MARKER_GAP): { x: number; y: number }[] {
  const at = points.map((p) => ({ ...p }));
  const edge = gap / 2;
  for (let round = 0; round < 60; round++) {
    let moved = false;
    for (let i = 0; i < at.length; i++) {
      for (let j = i + 1; j < at.length; j++) {
        let dx = at[j].x - at[i].x;
        let dy = at[j].y - at[i].y;
        let d = Math.hypot(dx, dy);
        if (d >= gap) continue;
        if (d < 0.01) {
          // Two places on one spot: part them along a fixed direction per pair.
          const angle = (i * 7 + j * 3) % 8 * (Math.PI / 4);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 1;
        }
        const push = (gap - d) / 2 + 0.5;
        at[i].x -= (dx / d) * push;
        at[i].y -= (dy / d) * push;
        at[j].x += (dx / d) * push;
        at[j].y += (dy / d) * push;
        moved = true;
      }
    }
    for (const p of at) {
      p.x = Math.min(WIDTH - edge, Math.max(edge, p.x));
      p.y = Math.min(HEIGHT - edge, Math.max(edge, p.y));
    }
    if (!moved) break;
  }
  return at;
}

function projection(zoom: number) {
  const world = TILE * 2 ** zoom;
  return geoMercator()
    .scale(world / (2 * Math.PI))
    .translate([world / 2, world / 2]);
}

/** The closest zoom at which every point fits inside the padded frame. */
export function fitZoom(points: readonly FramePoint[]): number {
  for (let zoom = MAX_ZOOM; zoom > MIN_ZOOM; zoom--) {
    const project = projection(zoom);
    const xy = points.map((p) => project([p.lon, p.lat]) ?? [0, 0]);
    const xs = xy.map((p) => p[0]);
    const ys = xy.map((p) => p[1]);
    if (Math.max(...xs) - Math.min(...xs) <= WIDTH - 2 * PAD && Math.max(...ys) - Math.min(...ys) <= HEIGHT - 2 * PAD) {
      return zoom;
    }
  }
  return MIN_ZOOM;
}

export function mapFrame(points: readonly FramePoint[]): Frame {
  if (points.length === 0) return { zoom: MIN_ZOOM, at: [], true: [], tiles: [] };
  const zoom = fitZoom(points);
  const project = projection(zoom);
  const xy = points.map((p) => project([p.lon, p.lat]) ?? [0, 0]);
  const xs = xy.map((p) => p[0]);
  const ys = xy.map((p) => p[1]);
  const left = (Math.min(...xs) + Math.max(...xs)) / 2 - WIDTH / 2;
  const top = (Math.min(...ys) + Math.max(...ys)) / 2 - HEIGHT / 2;
  const count = 2 ** zoom;
  const tiles: FrameTile[] = [];
  for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + HEIGHT) / TILE); ty++) {
    if (ty < 0 || ty >= count) continue;
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + WIDTH) / TILE); tx++) {
      tiles.push({ z: zoom, x: ((tx % count) + count) % count, y: ty, left: tx * TILE - left, top: ty * TILE - top });
    }
  }
  const truly = xy.map(([x, y]) => ({ x: x - left, y: y - top }));
  return { zoom, at: spread(truly), true: truly, tiles };
}

/** A frame length as a percentage of the frame's width or height, for CSS. */
export const across = (x: number) => `${((x / WIDTH) * 100).toFixed(3)}%`;
export const down = (y: number) => `${((y / HEIGHT) * 100).toFixed(3)}%`;
export const TILE_WIDTH = across(TILE);
export const TILE_HEIGHT = down(TILE);
