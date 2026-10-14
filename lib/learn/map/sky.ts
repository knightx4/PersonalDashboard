import type { StateBasis } from '@/lib/learn/graph/model';
import { spillOver, strengthWithEvidence, type EvidenceWeight, type StrengthInput } from '@/lib/learn/strength';
import type { Point } from './layout';
import { DOMAIN_HUES } from './view';

/**
 * The arithmetic behind Idea Space as a night sky (plan #1997.6), apart from
 * the canvas so it can be tested without a browser.
 *
 * - The camera: a centre in the layout's units and a scale in pixels per
 *   unit. Zooming keeps the point under the finger still.
 * - How a star looks for its strength: brighter, larger and with a wider
 *   glow the better the idea is known. An idea you do not know yet is a dim
 *   point, with a haze around it when known ideas sit beside it.
 * - Which names show at a zoom, and where, so that no two overlap.
 * - Where a vault note's speck of dust sits beside its idea.
 *
 * The map is a night sky in both themes (decision #1997.4): light adds up on
 * a dark ground, which is what lets brightness carry how well an idea is
 * known. So these colours are fixed and do not read the theme's tokens; the
 * page around the map still follows the theme.
 */

// -- Colours -----------------------------------------------------------------

export const SKY = {
  /** The ground, darkest at the edges. */
  groundInner: '#0b1024',
  groundOuter: '#04060d',
  /** A vault note behind the ideas. */
  dust: 'rgba(168, 178, 214, 0.22)',
  /** An idea you do not know yet: a hollow ring, ground not visited. */
  unlit: 'rgba(160, 170, 205, 0.7)',
  /** A vault note's speck as the legend draws it, larger than on the map so it can be seen. */
  dustSwatch: 'rgba(168, 178, 214, 0.75)',
  /** The haze known ideas spill onto an unknown one beside them, as r, g, b. */
  haze: [120, 140, 255] as const,
  /** An idea held wrongly: a ring, since its strength is nought. */
  mixedUp: 'rgba(240, 114, 126, 0.75)',
  /** Names of places, ideas, and the idea pointed at. */
  placeName: 'rgba(196, 203, 232, 0.78)',
  ideaName: 'rgba(232, 236, 255, 0.9)',
  focusName: '#ffffff',
  /** A dark band behind a name, so it reads over a bright star. */
  nameShadow: 'rgba(4, 6, 13, 0.6)',
  /** The lines and rings that join an idea to its six nearest. */
  thread: 'rgba(255, 255, 255, 0.5)',
  ring: 'rgba(255, 255, 255, 0.8)',
  /** A star with no domain colour. */
  plain: '#c9cfe6',
  /** The zoom buttons and the hover card, which sit on the sky in every theme. */
  panel: 'rgba(14, 20, 42, 0.92)',
  panelRing: 'rgba(255, 255, 255, 0.16)',
  panelText: '#e8ecff',
  panelMuted: 'rgba(196, 203, 232, 0.78)',
} as const;

/** A star's core colour: its domain's, so hue still says where an idea is. */
export function starColour(slot: number | 'other' | 'none'): string {
  return typeof slot === 'number' ? (DOMAIN_HUES[slot]?.dark ?? SKY.plain) : SKY.plain;
}

/** '#rrggbb' as r, g, b. */
export function rgbOf(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// -- The camera ----------------------------------------------------------------

/** Where the camera looks (layout units) and how close (pixels per unit). */
export type Camera = { x: number; y: number; k: number };

/** The gap kept between the outermost stars and the frame at the whole-map view, in pixels. */
export const FIT_INSET = 28;
/** How far out and in the camera may go, as multiples of the whole-map scale. */
export const MIN_ZOOM = 0.6;
export const MAX_ZOOM = 40;

/** The camera that shows every point, centred, with one scale for both directions. */
export function fitCamera(points: readonly Point[], width: number, height: number, inset = FIT_INSET): Camera {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, k: Math.max(1, Math.min(width, height) / 2) };
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const k = Math.min(Math.max(width - 2 * inset, 1) / spanX, Math.max(height - 2 * inset, 1) / spanY);
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, k };
}

/** A layout point on the screen. Up in the layout is up on the screen. */
export function toScreen(camera: Camera, p: Point, width: number, height: number): Point {
  return { x: width / 2 + (p.x - camera.x) * camera.k, y: height / 2 - (p.y - camera.y) * camera.k };
}

/** A screen point in the layout. */
export function toWorld(camera: Camera, s: Point, width: number, height: number): Point {
  return { x: camera.x + (s.x - width / 2) / camera.k, y: camera.y - (s.y - height / 2) / camera.k };
}

/** Zoomed by `factor` about a screen point, which stays where it is, within the camera's limits. */
export function zoomAbout(
  camera: Camera,
  at: Point,
  factor: number,
  width: number,
  height: number,
  fitK: number,
): Camera {
  const k = Math.min(Math.max(camera.k * factor, fitK * MIN_ZOOM), fitK * MAX_ZOOM);
  const anchor = toWorld(camera, at, width, height);
  return { k, x: anchor.x - (at.x - width / 2) / k, y: anchor.y + (at.y - height / 2) / k };
}

/** Moved by a drag of `dx`, `dy` pixels: the ground follows the finger. */
export function panBy(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, x: camera.x - dx / camera.k, y: camera.y + dy / camera.k };
}

/** Part of the way from one camera to another, for a flight; the scale moves evenly in its logarithm. */
export function between(from: Camera, to: Camera, t: number): Camera {
  const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * t);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, k };
}

/** Eases a flight in and out. */
export function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

// -- Stars -----------------------------------------------------------------------

export type StarLook = {
  /** The bright point, in pixels across. */
  core: number;
  coreAlpha: number;
  /** The glow around it, in pixels across; zero for none. */
  glow: number;
  glowAlpha: number;
  /** The haze around an unknown idea, in pixels across; zero for none. */
  haze: number;
  hazeAlpha: number;
};

/**
 * How a star looks for its strength (0 to 1) and, for an idea not known yet,
 * the haze its known neighbours give it (0 to 1). `zoom` is the camera's
 * scale over the whole-map scale: stars grow a little as you come closer, so
 * a close view does not read as empty.
 */
export function starLook(strength: number, haze: number, zoom: number): StarLook {
  const grow = Math.min(Math.max(zoom, 1), 8) ** 0.3;
  const s = Math.min(Math.max(strength, 0), 1);
  if (s <= 0) {
    const h = Math.min(Math.max(haze, 0), 1);
    return {
      core: 6 * grow,
      coreAlpha: 0.8,
      glow: 0,
      glowAlpha: 0,
      haze: h > 0.02 ? (14 + 16 * h) * grow : 0,
      hazeAlpha: h > 0.02 ? 0.12 + 0.3 * h : 0,
    };
  }
  const root = Math.sqrt(s);
  return {
    core: (4.5 + 3.5 * root) * grow,
    coreAlpha: 0.75 + 0.25 * root,
    glow: (14 + 34 * s) * grow,
    glowAlpha: 0.3 + 0.7 * s,
    haze: 0,
    hazeAlpha: 0,
  };
}

/** Up to this many stars in view, each glows in full. */
export const FULL_GLOW_STARS = 400;

/**
 * How much of its glow each star keeps with `inView` stars on the screen:
 * all of it up to 400, then falling with the square root, so ten thousand
 * stars at the whole-map view read as a sky rather than a white sheet.
 */
export function crowding(inView: number): number {
  return inView <= FULL_GLOW_STARS ? 1 : Math.sqrt(FULL_GLOW_STARS / inView);
}

// -- Names ------------------------------------------------------------------------

/** Below this zoom the map names its places; from it on, its ideas. */
export const IDEA_NAMES_FROM = 2.4;
/** The most place names drawn at once at the whole-map view (Part 10, rule 4). */
export const MAX_PLACE_NAMES = 7;
/** The most names drawn at once, so the sky stays a sky. */
export const MAX_NAMES = 40;

export type NameCandidate = {
  id: string;
  text: string;
  /** Where the thing named is on the screen. */
  at: Point;
  /** Higher is placed first. */
  priority: number;
  /** The name's width in pixels, measured by the caller in the font it draws with. */
  width: number;
  /** How far from `at` to put the name: 0 centres it on the point, as a place's name. */
  gap: number;
};

export type Box = { x: number; y: number; w: number; h: number };
export type PlacedName = { id: string; text: string; box: Box };

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Puts down as many names as fit, most important first, each only where it
 * overlaps no name already down and stays inside the frame. A name with a gap
 * tries the right of its point, then the left, above and below; one without
 * is centred on its point or moved a line up or down.
 */
export function placeNames(
  candidates: readonly NameCandidate[],
  width: number,
  height: number,
  lineHeight: number,
  taken: readonly Box[] = [],
  max = MAX_NAMES,
  /** True where a box would cover a star, which no name may (R13). */
  covers: (box: Box) => boolean = () => false,
): PlacedName[] {
  const down: Box[] = [...taken];
  const out: PlacedName[] = [];
  const sorted = [...candidates].sort((a, b) => b.priority - a.priority);
  for (const name of sorted) {
    if (out.length >= max) break;
    const { at, width: w, gap } = name;
    const h = lineHeight;
    const tries: Box[] =
      gap > 0
        ? [
            { x: at.x + gap, y: at.y - h / 2, w, h },
            { x: at.x - gap - w, y: at.y - h / 2, w, h },
            { x: at.x - w / 2, y: at.y - gap - h, w, h },
            { x: at.x - w / 2, y: at.y + gap, w, h },
          ]
        : [
            [0, 0],
            [0, -h],
            [0, h],
            [0, -2 * h],
            [0, 2 * h],
            [-w / 2, 0],
            [w / 2, 0],
          ].map(([dx, dy]) => ({ x: at.x - w / 2 + dx!, y: at.y - h / 2 + dy!, w, h }));
    for (const box of tries) {
      if (box.x < 2 || box.y < 2 || box.x + box.w > width - 2 || box.y + box.h > height - 2) continue;
      if (down.some((other) => overlaps(box, other))) continue;
      if (covers(box)) continue;
      down.push(box);
      out.push({ id: name.id, text: name.text, box });
      break;
    }
  }
  return out;
}

/**
 * A lookup of the marks on the screen by cell, so a name can be checked
 * against every star near it without visiting all ten thousand. `add` takes
 * a mark's centre and radius; the returned test says whether a box covers
 * any mark, with `pad` pixels kept clear round each.
 */
export function markGrid(cell = 24) {
  const cells = new Map<number, number[]>();
  const key = (cx: number, cy: number) => cx * 100_003 + cy;
  return {
    add(x: number, y: number, r: number) {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const k = key(cx, cy);
      let list = cells.get(k);
      if (!list) cells.set(k, (list = []));
      list.push(x, y, r);
    },
    covers(box: Box, pad = 2): boolean {
      const reach = cell;
      const x0 = Math.floor((box.x - reach) / cell);
      const x1 = Math.floor((box.x + box.w + reach) / cell);
      const y0 = Math.floor((box.y - reach) / cell);
      const y1 = Math.floor((box.y + box.h + reach) / cell);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          const list = cells.get(key(cx, cy));
          if (!list) continue;
          for (let i = 0; i < list.length; i += 3) {
            const x = list[i]!;
            const y = list[i + 1]!;
            const r = list[i + 2]! + pad;
            const nx = Math.min(Math.max(x, box.x), box.x + box.w);
            const ny = Math.min(Math.max(y, box.y), box.y + box.h);
            if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
          }
        }
      }
      return false;
    },
  };
}

// -- Dust -----------------------------------------------------------------------------

/** How far a note at no likeness at all would sit from its idea, in layout units. */
export const DUST_SPREAD = 0.16;

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Where a vault note's speck sits: beside the idea it is most like, further
 * off the less alike they are, at an angle fixed by the note so it does not
 * move between visits.
 */
export function dustAt(idea: Point, noteId: string, similarity: number): Point {
  const h = hash(noteId);
  const angle = ((h & 0xffff) / 0x10000) * Math.PI * 2;
  const jitter = 0.6 + ((h >>> 16) / 0x10000) * 0.8;
  const r = DUST_SPREAD * (1 - Math.min(Math.max(similarity, 0), 1)) * jitter;
  return { x: idea.x + Math.cos(angle) * r, y: idea.y + Math.sin(angle) * r };
}

// -- The card -------------------------------------------------------------------------

/** How the idea's state came to be believed, as the card says it. */
export const EVIDENCE_TEXT: Record<StateBasis, string> = {
  tested: 'Tested',
  declared: 'You said you know it',
  inferred: 'Taken from an idea above it',
};

// -- Lighting the ideas -----------------------------------------------------------------

export type LightInput = {
  id: string;
  /** The idea's state row, or null when it has none (never seen). */
  stateRow: StrengthInput | null;
  neighbours: readonly { id: string; similarity: number }[];
  /** Notes, courses and work that back it (plan #2006.6); an untested idea glows from them up to EVIDENCE_CEILING. */
  evidence?: readonly EvidenceWeight[];
};

export type Light = { strength: number; haze: number };

/**
 * Every idea's strength on `on`, and the haze each idea not known yet takes
 * from the known ideas among its nearest (lib/learn/strength.ts). Takes the
 * date, so a timeline can light the map as it stood on any day. An untested
 * idea with evidence found by then takes its evidence's score when that is
 * higher than its own.
 */
export function lightOn(ideas: readonly LightInput[], on: Date): Map<string, Light> {
  const strengthOf = new Map<string, number>();
  for (const idea of ideas) strengthOf.set(idea.id, strengthWithEvidence(idea.stateRow, idea.evidence ?? [], on));
  const out = new Map<string, Light>();
  for (const idea of ideas) {
    const unknown = !idea.stateRow || idea.stateRow.state === 'unknown';
    const haze = unknown
      ? spillOver(idea.neighbours.map((n) => ({ strength: strengthOf.get(n.id) ?? 0, similarity: n.similarity })))
      : 0;
    out.set(idea.id, { strength: strengthOf.get(idea.id) ?? 0, haze });
  }
  return out;
}
