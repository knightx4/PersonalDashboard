'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import type { KnowledgeState } from '@/lib/learn/graph/model';
import type { Point } from '@/lib/learn/map/layout';
import {
  EVIDENCE_TEXT,
  IDEA_NAMES_FROM,
  SKY,
  between,
  crowding,
  ease,
  fitCamera,
  panBy,
  placeNames,
  rgbOf,
  starColour,
  starLook,
  markGrid,
  MAX_PLACE_NAMES,
  toScreen,
  zoomAbout,
  MAX_ZOOM,
  type Box,
  type Camera,
  type NameCandidate,
  type PlacedName,
} from '@/lib/learn/map/sky';
import { STATE_MARK_LABEL, markOf } from '@/lib/learn/map/view';
import { graphHeight, paramsFor, type IdeaGraph, type Opened } from '@/lib/learn/map/place-graph';
import { halvesOn, stateSetAt, type StrengthInput } from '@/lib/learn/strength';
import type { LightThen } from '@/lib/learn/map/timeline';
import { cn } from '@/lib/cn';
import { LEVEL4_FROM, nameTopics, topicTier, type TopicOnMap } from '@/lib/learn/map/topics';
import { usePick } from './pick';
import { PlaceGraph } from './place-graph';
import { whenDate } from '@/lib/core/when';

/**
 * Idea Space as a night sky (plan #1997.6): every idea a star on a canvas.
 *
 * A star's brightness, size and glow come from its strength score, so what
 * you know well and lately shines and what is fading dims; its colour is its
 * domain's, so hue still says where. An idea you do not know yet is a dim
 * point, hazed when known ideas sit beside it. Vault notes are faint dust
 * behind. The sky is dark in both themes (decision #1997.4); the colours are
 * in lib/learn/map/sky.ts.
 *
 * You scroll, pinch and drag to move from the whole map down to single
 * ideas; the buttons in the corner and the keyboard do the same. Place names
 * show when zoomed out and idea names when zoomed in, never overlapping.
 * Pointing at a star shows a card with its state, evidence, when it was last
 * shown and when it next halves; a tap opens it in the rail, which the
 * address keeps.
 *
 * The canvas is drawn only when something changes, and only the stars in
 * view, which holds 10,000 ideas at a smooth frame rate. Until the browser
 * has drawn it, the server's first paint is a plain picture of the same sky.
 *
 * Tapping a place's name flies the camera into the place and opens it as a
 * graph you can read (plan #1997.7, place-graph.tsx). The address holds the
 * place, so the back button flies out to the whole map again. While a graph
 * is open the sky behind it holds still.
 *
 * The timeline under the map (plan #1997.8) hands in `replay`, the map as it
 * stood on a day. The same stars are relit from it, and those not written yet
 * are left out, so the camera and every star's place hold still while it plays.
 */

export type Star = {
  id: string;
  name: string;
  /** Where the current layout puts it, in the layout's units. */
  at: Point;
  state: KnowledgeState;
  stateRow: StrengthInput | null;
  /** Tested strength, 0 to 1: brightness (plan #2187.1). */
  strength: number;
  /** Nearness to tested ideas, 0 to 1, for a star with no strength: the blue haze. */
  haze: number;
  /** A course, your work, your writing or your word touched it, 0 to 1: the gold halo. */
  exposure: number;
  /** The domain's colour slot, `other` for a domain without one, `none` for no domain. */
  slot: number | 'other' | 'none';
  domainId: string | null;
  neighbours: string[];
  /** Not written yet on the day the timeline shows (plan #1997.8), so not drawn. */
  absent?: boolean;
  /** What backs it, "2 notes and a course", or null with no evidence (plan #2006.6). */
  backedBy?: string | null;
};

/** A topic of the frame (plan #2016.5) where the current layout puts it. */
export type SkyTopic = TopicOnMap & { at: Point };

/**
 * A chosen goal's topics on the sky (plan #2187.2): each where the layout
 * puts it with the radius of its target ring in pixels, and the lines where
 * one requires another.
 */
export type Constellation = {
  stars: readonly { id: string; name: string; at: Point; ring: number }[];
  lines: readonly { from: Point; to: Point }[];
};

/** A name for the zoomed-out sky: a place, or a domain while no place is named. */
export type SkyName = { id: string; kind: 'place' | 'domain'; text: string; at: Point; weight: number };

/** How close a pointer has to come to a star to point at it, and a finger to tap it, in pixels. */
const POINT_REACH = 14;
const TAP_REACH = 22;
/** How far a press may move and still be a tap rather than a drag, in pixels. */
const DRAG_SLOP = 5;
/** One press of a zoom button or key, and one notch of a mouse wheel's worth of scroll. */
const ZOOM_STEP = 1.8;
const WHEEL_RATE = 0.0016;
/** A flight's length, and a layout change's. */
const FLY_MS = 420;
const MOVE_MS = 450;
/** How far an arrow key moves the sky, in pixels. */
const KEY_PAN = 80;
/** The room kept round a place's ideas when the camera flies into it, in pixels. */
const PLACE_INSET = 60;
/** What is left of the stars behind an open graph. */
const BEHIND_GRAPH = 0.12;
/** How far round a name a tap still lands on it, in pixels. */
const NAME_REACH = 4;

const PLACE_FONT = '400 11px';
const IDEA_FONT = '400 11px';
const FOCUS_FONT = '600 13px';
const TOPIC3_FONT = '600 10px';
const TOPIC4_FONT = 'italic 400 11px';
const MORE_FONT = '400 10px';
/** A Level 3 topic's diamond and a Level 4 one's, half across, in pixels. */
const TOPIC3_R = 3.5;
const TOPIC4_R = 2.5;
const NAME_LINE = 16;
/** What is left of a star outside the idea in focus or the domain picked out. */
const FADED = 0.22;
/** The glow layer's resolution, as a share of the frame's CSS pixels. */
const GLOW_SCALE = 0.5;
/** A glow fainter than this is not drawn: in a crowded view it adds nothing the eye sees. */
const FAINTEST_GLOW = 0.1;
/** A core smaller than this many pixels is drawn as a square rather than stamped. */
const SQUARE_CORE_BELOW = 7;

/** A soft round sprite of one colour, drawn once and stamped for every star. */
function sprite(rgb: readonly [number, number, number], hard: number): HTMLCanvasElement {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const [r, gr, b] = rgb;
  g.addColorStop(0, `rgba(${r},${gr},${b},1)`);
  g.addColorStop(hard, `rgba(${r},${gr},${b},0.35)`);
  g.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

/** A star's bright point: white at its heart, its colour at its rim. */
function coreSprite(rgb: readonly [number, number, number]): HTMLCanvasElement {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const [r, gr, b] = rgb;
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, `rgba(${r},${gr},${b},1)`);
  g.addColorStop(1, `rgba(${r},${gr},${b},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}


function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function StarSky({
  stars,
  names,
  dust,
  asOf,
  label,
  pointingAt = null,
  graph = null,
  replay = null,
  topics = [],
  zoomOn = null,
  constellation = null,
}: {
  stars: readonly Star[];
  names: readonly SkyName[];
  /** Wikipedia's topics as the map's frame (plan #2016.5): every Level 3 one and the Level 4 ones unlocked. */
  topics?: readonly SkyTopic[];
  /** The gallery opens the sky flown into this topic, as a press on its name would. */
  zoomOn?: string | null;
  /** Vault notes, in the layout's units. */
  dust: readonly Point[];
  /** The moment the strengths are for, as an ISO string. */
  asOf: string;
  /** What the map is, for a screen reader. */
  label: string;
  /** The gallery draws the card held open over this idea. */
  pointingAt?: string | null;
  /** The place or neighbourhood opened as a graph, or null for the whole map. */
  graph?: IdeaGraph | null;
  /** The map as it stood on the day the timeline shows, or null for today. */
  replay?: ReadonlyMap<string, LightThen> | null;
  /** The goal chosen in the rail, drawn as lines and rings, or null for the plain sky. */
  constellation?: Constellation | null;
}) {
  const { selectedId, pick, params, clearDomain, set } = usePick();
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [drawn, setDrawn] = useState(false);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  /** Where the star the gallery holds the card over is on the screen, once drawn. */
  const [heldAt, setHeldAt] = useState<Point | null>(null);

  // -- What is drawn, kept in refs so a frame reads it without a render -----
  const camera = useRef<Camera | null>(null);
  const fitK = useRef(1);
  const flight = useRef<{ from: Camera; to: Camera; start: number; ms: number } | null>(null);
  const shown = useRef<{ xs: Float32Array; ys: Float32Array } | null>(null);
  const move = useRef<{ fromX: Float32Array; fromY: Float32Array; start: number } | null>(null);
  const raf = useRef<number | null>(null);
  const sprites = useRef<Map<string, { glow: HTMLCanvasElement; core: HTMLCanvasElement }>>(new Map());
  const hazeSprite = useRef<HTMLCanvasElement | null>(null);
  const glowLayer = useRef<HTMLCanvasElement | null>(null);
  const fontFamily = useRef<string | null>(null);
  const widths = useRef<Map<string, number>>(new Map());
  const drawRef = useRef<() => void>(() => {});
  const drawnOnce = useRef(false);
  const heldRef = useRef<Point | null>(null);
  /** The place names drawn last, where a tap opens them. */
  const nameBoxes = useRef<{ name: SkyName; box: Box }[]>([]);
  /** The topic names and "+23 more" counts drawn last, where a tap flies into the topic. */
  const topicBoxes = useRef<{ id: string; box: Box }[]>([]);
  /** The topic the map was last flown into, whose name is kept first. */
  const lastTopic = useRef<string | null>(zoomOn);
  /** The frame's height on the whole map, which a graph grows from. */
  const baseH = useRef<number | null>(null);
  const [mapH, setMapH] = useState<number | null>(null);
  const wasOpen = useRef(false);

  const byId = useMemo(() => new Map(stars.map((star, i) => [star.id, i])), [stars]);
  const starOf = useMemo(() => new Map(stars.map((star) => [star.id, star])), [stars]);
  // The stars as the timeline's day had them: the same ones in the same
  // order, relit, so nothing keyed on `stars` (places, the camera) moves.
  const lit = useMemo(
    () =>
      replay
        ? stars.map((star): Star => {
            const then = replay.get(star.id);
            return then
              ? {
                  ...star,
                  strength: then.strength,
                  haze: then.haze,
                  exposure: then.exposure,
                  state: then.state,
                  stateRow: then.stateRow,
                }
              : { ...star, strength: 0, haze: 0, exposure: 0, absent: true };
          })
        : stars,
    [stars, replay],
  );

  // The graph is drawn once the camera has arrived; until then the sky shows.
  // A page opened on a graph shows it at once, with nothing to fly in from.
  const [arrived, setArrived] = useState<{ key: string; from: Map<string, Point> | null } | null>(() =>
    graph ? { key: graph.key, from: null } : null,
  );
  const open = graph !== null;
  const shownGraph = graph && arrived?.key === graph.key ? arrived : null;
  const behind = useMemo(
    () => (shownGraph && graph ? new Set([...graph.core, ...graph.next]) : null),
    [shownGraph, graph],
  );
  const focusId = open ? null : (hover?.id ?? pointingAt ?? selectedId);
  const focusIndex = focusId ? (byId.get(focusId) ?? -1) : -1;

  // Kept for the draw, which runs outside React.
  const latest = useRef({ stars: lit, names, topics, dust, focusIndex, domain: params.domain, size, pointingAt, open, behind, constellation });
  useEffect(() => {
    latest.current = { stars: lit, names, topics, dust, focusIndex, domain: params.domain, size, pointingAt, open, behind, constellation };
  });

  // -- Measuring the frame --------------------------------------------------
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      setSize(box.width > 0 && box.height > 0 ? { w: Math.round(box.width), h: Math.round(box.height) } : null);
      // The whole map's height, which an open graph grows the frame from.
      if (box.height > 0 && (!latest.current.open || baseH.current === null)) {
        baseH.current = Math.round(box.height);
        setMapH(baseH.current);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // -- Drawing -------------------------------------------------------------
  const draw = useCallback(() => {
    raf.current = null;
    const el = canvas.current;
    const { stars, names, topics, dust, focusIndex, domain, size, pointingAt, open, behind, constellation } = latest.current;
    if (!el || !size || !camera.current || !shown.current) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const now = performance.now();
    let again = false;

    // The camera's flight, and the stars' move to a new layout.
    if (flight.current) {
      const f = flight.current;
      const t = Math.min(1, (now - f.start) / f.ms);
      camera.current = between(f.from, f.to, ease(t));
      if (t < 1) again = true;
      else flight.current = null;
    }
    const xs = shown.current.xs;
    const ys = shown.current.ys;
    let px = xs;
    let py = ys;
    if (move.current && move.current.fromX.length === xs.length) {
      const t = Math.min(1, (now - move.current.start) / MOVE_MS);
      const e = ease(t);
      px = new Float32Array(xs.length);
      py = new Float32Array(ys.length);
      for (let i = 0; i < xs.length; i++) {
        px[i] = move.current.fromX[i]! + (xs[i]! - move.current.fromX[i]!) * e;
        py[i] = move.current.fromY[i]! + (ys[i]! - move.current.fromY[i]!) * e;
      }
      if (t < 1) again = true;
      else move.current = null;
    }

    const cam = camera.current;
    const { w, h } = size;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    const ground = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
    ground.addColorStop(0, SKY.groundInner);
    ground.addColorStop(1, SKY.groundOuter);
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, w, h);

    const zoom = cam.k / fitK.current;
    const sx = (x: number) => w / 2 + (x - cam.x) * cam.k;
    const sy = (y: number) => h / 2 - (y - cam.y) * cam.k;

    // Dust, one path for every speck.
    ctx.fillStyle = SKY.dust;
    ctx.beginPath();
    const speck = Math.min(1 + zoom * 0.08, 2.2);
    for (const p of dust) {
      const x = sx(p.x);
      const y = sy(p.y);
      if (x < -2 || y < -2 || x > w + 2 || y > h + 2) continue;
      ctx.rect(x - speck / 2, y - speck / 2, speck, speck);
    }
    ctx.fill();

    // The topics, faint diamonds under the stars: every Level 3 one, and
    // from LEVEL4_FROM the Level 4 ones something has unlocked.
    const tier = topicTier(zoom);
    const shownTopics = open ? [] : topics.filter((topic) => topic.level === 3 || tier > 0);
    const diamond = (x: number, y: number, r: number) => {
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
    };
    const onScreen = (x: number, y: number) => x >= -6 && y >= -6 && x <= w + 6 && y <= h + 6;
    // The landmarks nothing touches are drawn after the names, round them.
    if (shownTopics.length > 0) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = SKY.topicUnlocked;
      ctx.beginPath();
      for (const topic of shownTopics) {
        if (!topic.touched || topic.state === 'lit') continue;
        const x = sx(topic.at.x);
        const y = sy(topic.at.y);
        if (onScreen(x, y)) diamond(x, y, topic.level === 3 ? TOPIC3_R : TOPIC4_R);
      }
      ctx.stroke();
      const [r, g, b] = SKY.topicLit;
      for (const topic of shownTopics) {
        if (topic.state !== 'lit') continue;
        const x = sx(topic.at.x);
        const y = sy(topic.at.y);
        if (!onScreen(x, y)) continue;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.45 + 0.55 * topic.strength})`;
        ctx.beginPath();
        diamond(x, y, (topic.level === 3 ? TOPIC3_R : TOPIC4_R) + 0.5);
        ctx.fill();
      }
    }

    // Who stands out: the idea in focus and its six nearest, or the domain picked in the legend.
    const focus = focusIndex >= 0 && !stars[focusIndex]!.absent ? stars[focusIndex] : undefined;
    const near = new Set(focus?.neighbours ?? []);
    // A chosen goal steps the sky back, as a domain picked out does, so its
    // rings and lines read over ten thousand stars (plan #2187.2).
    const goalOn = !open && !!constellation && constellation.stars.length > 0;
    const litUp = (star: Star) =>
      behind
        ? false
        : focus
          ? star.id === focus.id || near.has(star.id)
          : domain
            ? star.domainId === domain
            : !goalOn;
    const faded = behind ? BEHIND_GRAPH : FADED;

    // A crowded view would add up to white, so the glow and haze thin out
    // with how many stars are in view, and come back as you zoom in.
    let inView = 0;
    for (let i = 0; i < stars.length; i++) {
      if (stars[i]!.absent) continue;
      const x = sx(px[i]!);
      const y = sy(py[i]!);
      if (x >= 0 && y >= 0 && x <= w && y <= h) inView += 1;
    }
    const crowd = crowding(inView);
    // Rings overlap into a grey wash sooner than glow adds up to white, so
    // the halo thins with the square: gone past a few thousand stars in
    // view, back as you zoom in.
    const haloCrowd = crowd * crowd;

    // Haze and glow are soft, so they are drawn at half the resolution on a
    // layer of their own and laid over the sky in one go: a quarter of the
    // pixels to fill, which is most of the cost of a crowded frame.
    let layer = glowLayer.current;
    if (!layer) {
      layer = document.createElement('canvas');
      glowLayer.current = layer;
    }
    const lw = Math.max(1, Math.round(w * GLOW_SCALE));
    const lh = Math.max(1, Math.round(h * GLOW_SCALE));
    if (layer.width !== lw || layer.height !== lh) {
      layer.width = lw;
      layer.height = lh;
    }
    const glow = layer.getContext('2d')!;
    glow.setTransform(1, 0, 0, 1, 0, 0);
    glow.globalCompositeOperation = 'source-over';
    glow.globalAlpha = 1;
    glow.clearRect(0, 0, lw, lh);
    glow.setTransform(GLOW_SCALE, 0, 0, GLOW_SCALE, 0, 0);
    glow.globalCompositeOperation = 'lighter';

    // Cores add up as light does, on the sky itself. In a crowded view a
    // small core is a square, gathered by colour and brightness into one
    // path each, since a few fills cost less than ten thousand stamps.
    ctx.globalCompositeOperation = 'lighter';
    const unlit: number[] = [];
    // Stars met without a test, ringed once the cores are down.
    const haloed: number[] = [];
    const squares = new Map<string, number[]>();
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i]!;
      if (star.absent || behind?.has(star.id)) continue;
      const x = sx(px[i]!);
      const y = sy(py[i]!);
      const look = starLook(star.strength, star.haze, zoom, star.exposure);
      const reach = Math.max(look.glow, look.haze, look.halo) / 2 + 2;
      if (x < -reach || y < -reach || x > w + reach || y > h + reach) continue;
      const dim = litUp(star) ? 1 : faded;
      if (look.haze > 0 && hazeSprite.current && look.hazeAlpha * dim * crowd >= FAINTEST_GLOW) {
        glow.globalAlpha = look.hazeAlpha * dim * crowd;
        glow.drawImage(hazeSprite.current, x - look.haze / 2, y - look.haze / 2, look.haze, look.haze);
      }
      if (look.halo > 0 && look.haloAlpha * dim * haloCrowd >= FAINTEST_GLOW) haloed.push(i);
      if (star.strength <= 0) {
        unlit.push(i);
        continue;
      }
      const art = sprites.current.get(starColour(star.slot));
      if (!art) continue;
      const glowAlpha = look.glowAlpha * dim * crowd;
      if (glowAlpha >= FAINTEST_GLOW) {
        glow.globalAlpha = glowAlpha;
        glow.drawImage(art.glow, x - look.glow / 2, y - look.glow / 2, look.glow, look.glow);
      }
      if (crowd < 1 && look.core < SQUARE_CORE_BELOW) {
        const key = `${starColour(star.slot)}|${Math.round(look.coreAlpha * dim * 4)}`;
        let list = squares.get(key);
        if (!list) squares.set(key, (list = []));
        list.push(x, y, Math.max(4, look.core * 0.7));
        continue;
      }
      ctx.globalAlpha = look.coreAlpha * dim;
      ctx.drawImage(art.core, x - look.core / 2, y - look.core / 2, look.core, look.core);
    }
    for (const [key, list] of squares) {
      const [colour, level] = key.split('|');
      ctx.fillStyle = colour!;
      ctx.globalAlpha = Number(level) / 4;
      ctx.beginPath();
      for (let j = 0; j < list.length; j += 3) {
        const half = list[j + 2]! / 2;
        ctx.rect(list[j]! - half, list[j + 1]! - half, half * 2, half * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(layer, 0, 0, w, h);

    // Ideas not known yet: hollow rings near a star's size, ground not
    // visited yet (Part 10, rule 2), faded outside the focus.
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = SKY.unlit;
    ctx.lineWidth = 1;
    const unlitR = starLook(0, 0, zoom).core / 2;
    for (const pass of [true, false]) {
      ctx.globalAlpha = pass ? 1 : faded;
      ctx.beginPath();
      for (const i of unlit) {
        const star = stars[i]!;
        if (litUp(star) !== pass) continue;
        const x = sx(px[i]!);
        const y = sy(py[i]!);
        ctx.moveTo(x + unlitR, y);
        ctx.arc(x, y, unlitR, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Exposure: a thin hollow ring of pale gold round a star met in a course
    // or your writing, or one you said you know, with no question asked yet
    // (plan #2187.1). Stroked, never filled, so it adds no light to the core,
    // and thinned faster than the glow in a crowd.
    ctx.strokeStyle = `rgb(${SKY.halo.join(',')})`;
    ctx.lineWidth = 1.2;
    const haloR = starLook(0, 0, zoom, 1).halo / 2;
    for (const pass of [true, false]) {
      ctx.globalAlpha = haloCrowd * (pass ? 1 : faded) * 0.85;
      ctx.beginPath();
      for (const i of haloed) {
        if (litUp(stars[i]!) !== pass) continue;
        const x = sx(px[i]!);
        const y = sy(py[i]!);
        ctx.moveTo(x + haloR, y);
        ctx.arc(x, y, haloR, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // An idea held wrongly wears a ring, faded with the rest outside the
    // focus or the domain picked out.
    ctx.strokeStyle = SKY.mixedUp;
    ctx.lineWidth = 1;
    for (const pass of [true, false]) {
      ctx.globalAlpha = Math.max(0.2, crowd) * (pass ? 1 : faded);
      ctx.beginPath();
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i]!;
        if (star.state !== 'misconception' || star.absent || litUp(star) !== pass || behind?.has(star.id)) continue;
        const x = sx(px[i]!);
        const y = sy(py[i]!);
        if (x < -8 || y < -8 || x > w + 8 || y > h + 8) continue;
        ctx.moveTo(x + 5, y);
        ctx.arc(x, y, 5, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // The goal chosen in the rail (plan #2187.2): faint lines where one of
    // its topics requires another, then a thin dashed ring round each topic,
    // wider for a higher target, with a point at its middle. Stroked only,
    // so a goal adds no light, and hidden while a graph is open.
    const goalStars = goalOn ? constellation!.stars : [];
    if (goalStars.length > 0) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeStyle = SKY.constellation;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const line of constellation!.lines) {
        ctx.moveTo(sx(line.from.x), sy(line.from.y));
        ctx.lineTo(sx(line.to.x), sy(line.to.y));
      }
      ctx.stroke();
      ctx.strokeStyle = SKY.target;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      for (const star of goalStars) {
        const x = sx(star.at.x);
        const y = sy(star.at.y);
        if (!onScreen(x, y)) continue;
        ctx.moveTo(x + star.ring, y);
        ctx.arc(x, y, star.ring, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = SKY.target;
      ctx.beginPath();
      for (const star of goalStars) {
        const x = sx(star.at.x);
        const y = sy(star.at.y);
        if (!onScreen(x, y)) continue;
        ctx.moveTo(x + 1.5, y);
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    // The idea in focus: threads to its six nearest and rings round them.
    // No name goes under the zoom buttons in the corner.
    const taken: Box[] = [ZOOM_PANEL(w, h)];
    if (focus) {
      const fx = sx(px[focusIndex]!);
      const fy = sy(py[focusIndex]!);
      ctx.strokeStyle = SKY.thread;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const id of focus.neighbours) {
        const j = byIdOf(stars, id);
        if (j < 0 || stars[j]!.absent) continue;
        ctx.moveTo(fx, fy);
        ctx.lineTo(sx(px[j]!), sy(py[j]!));
      }
      ctx.stroke();
      ctx.strokeStyle = SKY.ring;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const id of focus.neighbours) {
        const j = byIdOf(stars, id);
        if (j < 0 || stars[j]!.absent) continue;
        const x = sx(px[j]!);
        const y = sy(py[j]!);
        ctx.moveTo(x + 7, y);
        ctx.arc(x, y, 7, 0, Math.PI * 2);
      }
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(fx, fy, 9, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Names: the one in focus first, then places zoomed out or ideas zoomed
    // in, none covering a star (R13).
    const marks = markGrid();
    for (let i = 0; i < stars.length; i++) {
      if (stars[i]!.absent) continue;
      const x = sx(px[i]!);
      const y = sy(py[i]!);
      if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
      marks.add(x, y, starLook(stars[i]!.strength, 0, zoom).core / 2);
    }
    // Nor over a topic's diamond. A faint landmark gives way to a name instead.
    for (const topic of shownTopics) {
      if (!topic.touched) continue;
      const x = sx(topic.at.x);
      const y = sy(topic.at.y);
      if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
      marks.add(x, y, (topic.level === 3 ? TOPIC3_R : TOPIC4_R) + 1);
    }
    // Nor over a chosen goal's ring.
    for (const star of goalStars) marks.add(sx(star.at.x), sy(star.at.y), star.ring + 1);
    fontFamily.current ??= getComputedStyle(el).fontFamily || 'sans-serif';
    const family = fontFamily.current;
    const measure = (font: string, text: string) => {
      const key = `${font}|${text}`;
      let width = widths.current.get(key);
      if (width === undefined) {
        ctx.font = `${font} ${family}`;
        width = ctx.measureText(text).width;
        widths.current.set(key, width);
      }
      return width;
    };
    const drawnNames: Box[] = [];
    const write = (placed: PlacedName[], font: string, colour: string) => {
      drawnNames.push(...placed.map((p) => p.box));
      ctx.font = `${font} ${family}`;
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 2;
      ctx.strokeStyle = SKY.nameShadow;
      ctx.fillStyle = colour;
      for (const { text, box } of placed) {
        ctx.strokeText(text, box.x, box.y + box.h / 2);
        ctx.fillText(text, box.x, box.y + box.h / 2);
      }
    };
    if (focus) {
      const width = measure(FOCUS_FONT, focus.name);
      const placed = placeNames(
        [{ id: focus.id, text: focus.name, at: { x: sx(px[focusIndex]!), y: sy(py[focusIndex]!) }, priority: 1, width, gap: 13 }],
        w,
        h,
        NAME_LINE + 2,
        [],
        1,
        (box) => marks.covers(box),
      );
      taken.push(...placed.map((p) => p.box));
      write(placed, FOCUS_FONT, SKY.focusName);
    }
    // A chosen goal's topics are named before anything else but the focus,
    // seven at most, so you can read which ring is which.
    if (goalStars.length > 0) {
      const placed = placeNames(
        goalStars.map((star) => ({
          id: `goal:${star.id}`,
          text: star.name,
          at: { x: sx(star.at.x), y: sy(star.at.y) },
          priority: 1,
          width: measure(PLACE_FONT, star.name),
          gap: star.ring + 3,
        })),
        w,
        h,
        NAME_LINE,
        taken,
        MAX_PLACE_NAMES,
        // Over the stepped-back sky a name may cross a faint star, never a ring.
        (box) => goalStars.some((star) => {
          const x = sx(star.at.x);
          const y = sy(star.at.y);
          const r = star.ring + 1;
          return x + r > box.x && x - r < box.x + box.w && y + r > box.y && y - r < box.y + box.h;
        }),
      );
      write(placed, PLACE_FONT, SKY.ideaName);
      taken.push(...placed.map((p) => p.box));
    }
    nameBoxes.current = [];
    if (open) {
      // An open graph names its own ideas; the sky behind it stays unnamed.
    } else if (tier === 0) {
      const byName = new Map(names.map((name) => [name.id, name]));
      const candidates: NameCandidate[] = names.map((name) => ({
        id: name.id,
        text: name.text,
        at: { x: sx(name.at.x), y: sy(name.at.y) },
        priority: name.weight,
        width: measure(PLACE_FONT, name.text),
        gap: 0,
      }));
      const placed = placeNames(candidates, w, h, NAME_LINE, taken, MAX_PLACE_NAMES, (box) => marks.covers(box));
      nameBoxes.current = placed.map((p) => ({ name: byName.get(p.id)!, box: p.box }));
      write(placed, PLACE_FONT, SKY.placeName);
      taken.push(...placed.map((p) => p.box));
    }
    // The topics' names, at most seven at each level, strongest first.
    topicBoxes.current = [];
    if (!open && shownTopics.length > 0) {
      const named = nameTopics({
        topics: shownTopics,
        tier,
        at: (topic) => ({ x: sx(topic.at.x), y: sy(topic.at.y) }),
        width: w,
        height: h,
        lineHeight: NAME_LINE,
        measure: (topic, level) =>
          typeof topic === 'string'
            ? measure(MORE_FONT, topic)
            : measure(level === 3 ? TOPIC3_FONT : TOPIC4_FONT, level === 3 ? topic.title.toUpperCase() : topic.title),
        gap: TOPIC3_R + 4,
        taken,
        covers: (box) => marks.covers(box),
        first: lastTopic.current,
      });
      write(named.level3, TOPIC3_FONT, SKY.topicName);
      write(named.level4, TOPIC4_FONT, SKY.topicName4);
      write(named.more, MORE_FONT, SKY.topicMore);
      for (const p of [...named.level3, ...named.level4, ...named.more]) {
        taken.push(p.box);
        topicBoxes.current.push({ id: p.id, box: p.box });
      }
    }
    if (!open && zoom >= IDEA_NAMES_FROM) {
      const candidates: NameCandidate[] = [];
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i]!;
        if (i === focusIndex || star.absent || (focus && !litUp(star))) continue;
        const x = sx(px[i]!);
        const y = sy(py[i]!);
        if (x < 0 || y < 0 || x > w || y > h) continue;
        candidates.push({
          id: star.id,
          text: star.name,
          at: { x, y },
          priority: star.strength + star.haze * 0.3 + (focus ? 1 : 0),
          width: measure(IDEA_FONT, star.name),
          gap: starLook(star.strength, 0, zoom).core / 2 + 4,
        });
      }
      write(
        placeNames(candidates, w, h, NAME_LINE, taken, undefined, (box) => marks.covers(box)),
        IDEA_FONT,
        SKY.ideaName,
      );
    }

    // Level 3 landmarks nothing touches, faint, and never under a name.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = SKY.topicLandmark;
    ctx.beginPath();
    for (const topic of shownTopics) {
      if (topic.touched) continue;
      const x = sx(topic.at.x);
      const y = sy(topic.at.y);
      if (!onScreen(x, y)) continue;
      const r = TOPIC3_R + 2;
      if (drawnNames.some((b) => x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h)) continue;
      diamond(x, y, TOPIC3_R);
    }
    ctx.stroke();

    // The gallery's held card follows its star.
    const held = pointingAt ? byIdOf(stars, pointingAt) : -1;
    const heldPoint = held >= 0 ? { x: sx(px[held]!), y: sy(py[held]!) } : null;
    if (heldPoint?.x !== heldRef.current?.x || heldPoint?.y !== heldRef.current?.y) {
      heldRef.current = heldPoint;
      setHeldAt(heldPoint);
    }
    if (!drawnOnce.current) {
      drawnOnce.current = true;
      setDrawn(true);
    }

    if (again) raf.current = requestAnimationFrame(drawRef.current);
  }, []);

  useEffect(() => {
    drawRef.current = draw;
  }, [draw]);

  const redraw = useCallback(() => {
    if (raf.current === null) raf.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  // The sprites, once per colour.
  useEffect(() => {
    const colours = new Set(stars.map((star) => starColour(star.slot)));
    for (const colour of colours) {
      if (sprites.current.has(colour)) continue;
      const rgb = rgbOf(colour);
      sprites.current.set(colour, { glow: sprite(rgb, 0.22), core: coreSprite(rgb) });
    }
    if (!hazeSprite.current) hazeSprite.current = sprite(SKY.haze, 0.5);
    redraw();
  }, [stars, redraw]);

  /**
   * The camera over a topic: its own mark, its Level 4 topics and its ideas,
   * close enough that what is inside it shows. A Level 3 topic opens to its
   * Level 4 topics, a Level 4 one to its ideas' names.
   */
  const topicCamera = useCallback(
    (id: string, w: number, h: number): Camera | null => {
      const topic = topics.find((t) => t.id === id);
      if (!topic) return null;
      const points: Point[] = [topic.at];
      for (const t of topics) if (t.parentId === id) points.push(t.at);
      for (const ideaId of topic.ideaIds) {
        const star = starOf.get(ideaId);
        if (star) points.push(star.at);
      }
      const fit = fitCamera(points, w, h, PLACE_INSET);
      // A Level 3 topic opens to where its Level 4 topics are named and its
      // ideas are not yet; a Level 4 one to its ideas' names.
      const [low, high] =
        topic.level === 3
          ? [LEVEL4_FROM * 1.05, IDEA_NAMES_FROM * 0.95]
          : [IDEA_NAMES_FROM * 1.05, MAX_ZOOM];
      return { ...fit, k: Math.min(Math.max(fit.k, fitK.current * low), fitK.current * high) };
    },
    [topics, starOf],
  );

  // The stars' places: a new layout moves every star from where it was.
  useEffect(() => {
    const xs = new Float32Array(stars.length);
    const ys = new Float32Array(stars.length);
    stars.forEach((star, i) => {
      xs[i] = star.at.x;
      ys[i] = star.at.y;
    });
    const before = shown.current;
    if (before && before.xs.length === xs.length && !reducedMotion()) {
      move.current = { fromX: before.xs, fromY: before.ys, start: performance.now() };
    }
    shown.current = { xs, ys };
    if (size) {
      const fit = fitCamera(stars.map((star) => star.at), size.w, size.h);
      const first = camera.current === null;
      fitK.current = fit.k;
      if (first) camera.current = (zoomOn && topicCamera(zoomOn, size.w, size.h)) || fit;
      else if (reducedMotion()) camera.current = fit;
      else flight.current = { from: camera.current!, to: fit, start: performance.now(), ms: MOVE_MS };
    }
    redraw();
    // Size changes are handled below; only the stars refit the camera here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stars, redraw]);

  // A new frame size keeps the view's middle and refits the scale's floor.
  useEffect(() => {
    if (!size) return;
    const fit = fitCamera(stars.map((star) => star.at), size.w, baseH.current ?? size.h);
    if (!camera.current) {
      fitK.current = fit.k;
      camera.current = (zoomOn && topicCamera(zoomOn, size.w, size.h)) || fit;
    } else if (!latest.current.open) camera.current = { ...camera.current, k: camera.current.k * (fit.k / fitK.current) };
    fitK.current = fit.k;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, redraw]);

  // Anything else drawn changed: the focus, the domain picked out, the names.
  useEffect(() => {
    redraw();
  }, [focusIndex, params.domain, names, topics, dust, behind, open, lit, constellation, redraw]);

  // -- Moving the camera ---------------------------------------------------
  const flyTo = useCallback(
    (to: Camera) => {
      if (!camera.current) return;
      if (reducedMotion()) {
        flight.current = null;
        camera.current = to;
      } else {
        flight.current = { from: camera.current, to, start: performance.now(), ms: FLY_MS };
      }
      redraw();
    },
    [redraw],
  );

  const zoomBy = useCallback(
    (factor: number, at?: Point) => {
      if (!camera.current || !size) return;
      const from = flight.current?.to ?? camera.current;
      flyTo(zoomAbout(from, at ?? { x: size.w / 2, y: size.h / 2 }, factor, size.w, size.h, fitK.current));
    },
    [flyTo, size],
  );

  const flyToTopic = useCallback(
    (id: string) => {
      if (!size) return;
      const to = topicCamera(id, size.w, size.h);
      if (!to) return;
      lastTopic.current = id;
      flyTo(to);
    },
    [flyTo, size, topicCamera],
  );

  const showAll = useCallback(() => {
    if (!size) return;
    flyTo(fitCamera(stars.map((star) => star.at), size.w, size.h));
  }, [flyTo, size, stars]);

  // -- Opening a place ---------------------------------------------------------
  // The camera flies into the place, and once it is there the ideas move from
  // where the map has them into the graph. Closing it flies back out.
  const openKey = graph?.key ?? null;
  const ready = size !== null;
  useEffect(() => {
    const frameSize = latest.current.size;
    if (!ready || !camera.current || !frameSize) return;
    const w = frameSize.w;
    const base = baseH.current ?? frameSize.h;
    if (!graph) {
      if (wasOpen.current) {
        wasOpen.current = false;
        flyTo(fitCamera(stars.map((star) => star.at), w, base));
      }
      return;
    }
    wasOpen.current = true;
    const ids = [...graph.core, ...graph.next];
    const h = graphHeight(w, ids.length, base);
    const core = graph.core.map((id) => starOf.get(id)?.at).filter((p): p is Point => p !== undefined);
    const fit = fitCamera(core, w, h, PLACE_INSET);
    const target = { ...fit, k: Math.min(fit.k, fitK.current * MAX_ZOOM) };
    const from = new Map<string, Point>();
    for (const id of ids) {
      const star = starOf.get(id);
      if (star) from.set(id, toScreen(target, star.at, w, h));
    }
    const key = graph.key;
    if (!drawnOnce.current || reducedMotion()) {
      flight.current = null;
      camera.current = target;
      redraw();
      const id = requestAnimationFrame(() => setArrived({ key, from: null }));
      return () => cancelAnimationFrame(id);
    }
    flyTo(target);
    const timer = setTimeout(() => setArrived({ key, from }), FLY_MS);
    return () => clearTimeout(timer);
    // Only opening or closing a graph moves the camera here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openKey, ready]);

  const openGraph = useCallback(
    (to: Opened) => set(paramsFor(to)),
    [set],
  );
  const closeGraph = useCallback(() => set({ place: null, around: null }), [set]);

  // An idea opened from the rail is brought into view if it is off the edge.
  useEffect(() => {
    if (!selectedId || !camera.current || !size || latest.current.open) return;
    const i = byId.get(selectedId);
    if (i === undefined) return;
    const s = toScreen(camera.current, stars[i]!.at, size.w, size.h);
    const margin = 40;
    if (s.x < margin || s.y < margin || s.x > size.w - margin || s.y > size.h - margin) {
      flyTo({ ...camera.current, x: stars[i]!.at.x, y: stars[i]!.at.y });
    }
    // Only a change of the open idea moves the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // The wheel zooms about the pointer. It is added by hand so it can stop the page scrolling.
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!camera.current || !latest.current.size || latest.current.open) return;
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const rate = event.ctrlKey ? WHEEL_RATE * 6 : WHEEL_RATE;
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
      flight.current = null;
      const { w, h } = latest.current.size;
      camera.current = zoomAbout(
        camera.current,
        { x: event.clientX - box.left, y: event.clientY - box.top },
        Math.exp(-delta * rate),
        w,
        h,
        fitK.current,
      );
      redraw();
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [redraw]);

  // -- Pointing, tapping, dragging and pinching -------------------------------
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ start: Point; moved: boolean; pinched: boolean }>({
    start: { x: 0, y: 0 },
    moved: false,
    pinched: false,
  });

  const local = (event: React.PointerEvent): Point => {
    const box = frame.current!.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const nearest = (at: Point, reach: number): number => {
    if (!camera.current || !size || !shown.current) return -1;
    const { xs, ys } = shown.current;
    const cam = camera.current;
    let best = -1;
    let bestDistance = reach * reach;
    const now = latest.current.stars;
    for (let i = 0; i < xs.length; i++) {
      if (now[i]?.absent) continue;
      const x = size.w / 2 + (xs[i]! - cam.x) * cam.k;
      const y = size.h / 2 - (ys[i]! - cam.y) * cam.k;
      const d = (x - at.x) ** 2 + (y - at.y) ** 2;
      if (d <= bestDistance) {
        best = i;
        bestDistance = d;
      }
    }
    return best;
  };

  /** The place or domain name under a point, if any. */
  const nameAt = (at: Point): SkyName | null => {
    for (const { name, box } of nameBoxes.current) {
      if (
        at.x >= box.x - NAME_REACH &&
        at.x <= box.x + box.w + NAME_REACH &&
        at.y >= box.y - NAME_REACH &&
        at.y <= box.y + box.h + NAME_REACH
      )
        return name;
    }
    return null;
  };
  /** The topic whose name or "+23 more" is under a point, if any. */
  const topicAt = (at: Point): string | null => {
    for (const { id, box } of topicBoxes.current) {
      if (
        at.x >= box.x - NAME_REACH &&
        at.x <= box.x + box.w + NAME_REACH &&
        at.y >= box.y - NAME_REACH &&
        at.y <= box.y + box.h + NAME_REACH
      )
        return id;
    }
    return null;
  };
  const [overName, setOverName] = useState(false);

  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    if (open) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = local(event);
    pointers.current.set(event.pointerId, at);
    if (pointers.current.size === 1) gesture.current = { start: at, moved: false, pinched: false };
    else gesture.current.pinched = true;
    flight.current = null;
  };

  const moveTo = (event: React.PointerEvent<HTMLDivElement>) => {
    if (open) return;
    const at = local(event);
    const last = pointers.current.get(event.pointerId);
    if (!last) {
      // A mouse passing over: the star under it is pointed at, and a name shows it can be pressed.
      if (event.pointerType !== 'mouse') return;
      const onName = nameAt(at) !== null || topicAt(at) !== null;
      if (onName !== overName) setOverName(onName);
      const i = onName ? -1 : nearest(at, POINT_REACH);
      const id = i >= 0 ? stars[i]!.id : null;
      if (id !== (hover?.id ?? null)) setHover(id ? { id, x: at.x, y: at.y } : null);
      return;
    }
    if (!camera.current || !size) return;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const other = a === last ? b! : a!;
      const before = { x: (last.x + other.x) / 2, y: (last.y + other.y) / 2 };
      const after = { x: (at.x + other.x) / 2, y: (at.y + other.y) / 2 };
      const factor = Math.hypot(at.x - other.x, at.y - other.y) / Math.max(Math.hypot(last.x - other.x, last.y - other.y), 1);
      camera.current = zoomAbout(
        panBy(camera.current, after.x - before.x, after.y - before.y),
        after,
        factor,
        size.w,
        size.h,
        fitK.current,
      );
    } else {
      const start = gesture.current.start;
      if (!gesture.current.moved && Math.hypot(at.x - start.x, at.y - start.y) < DRAG_SLOP) return;
      gesture.current.moved = true;
      camera.current = panBy(camera.current, at.x - last.x, at.y - last.y);
    }
    pointers.current.set(event.pointerId, at);
    if (hover) setHover(null);
    redraw();
  };

  const up = (event: React.PointerEvent<HTMLDivElement>) => {
    const had = pointers.current.delete(event.pointerId);
    if (!had || pointers.current.size > 0) return;
    if (gesture.current.moved || gesture.current.pinched) return;
    const at = local(event);
    // A place's name opens it; a domain's picks out its ideas, as the legend does.
    const name = nameAt(at);
    if (name) {
      if (name.kind === 'place') openGraph({ kind: 'place', id: name.id });
      else set({ domain: params.domain === name.id ? null : name.id, idea: null });
      return;
    }
    // A topic's name, or the count of those not named, flies into it.
    const topicId = topicAt(at);
    if (topicId) {
      flyToTopic(topicId);
      return;
    }
    const i = nearest(at, event.pointerType === 'mouse' ? POINT_REACH : TAP_REACH);
    if (i < 0) {
      // Empty sky lets go of the open idea, then of a domain picked out in the legend.
      if (selectedId) pick(null);
      else if (params.domain) clearDomain();
      return;
    }
    pick(stars[i]!.id);
  };

  const cancel = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
  };

  const key = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (open) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeGraph();
      }
      return;
    }
    if (!camera.current) return;
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [KEY_PAN, 0],
      ArrowRight: [-KEY_PAN, 0],
      ArrowUp: [0, KEY_PAN],
      ArrowDown: [0, -KEY_PAN],
    };
    if (pan[event.key]) {
      const [dx, dy] = pan[event.key]!;
      flyTo(panBy(flight.current?.to ?? camera.current, dx, dy));
    } else if (event.key === '+' || event.key === '=') zoomBy(ZOOM_STEP);
    else if (event.key === '-' || event.key === '_') zoomBy(1 / ZOOM_STEP);
    else if (event.key === '0') showAll();
    else return;
    event.preventDefault();
  };

  // -- The card for the star pointed at ----------------------------------------
  const held = pointingAt && !open ? byId.get(pointingAt) : undefined;
  const pointed = open
    ? undefined
    : hover
      ? lit[byId.get(hover.id) ?? -1]
      : held !== undefined && heldAt
        ? lit[held]
        : undefined;
  const cardStar = pointed?.absent ? undefined : pointed;
  const cardAt = hover ?? heldAt;
  // A graph grows the frame so its names keep their room.
  const graphH =
    graph && size ? graphHeight(size.w, graph.core.length + graph.next.length, mapH ?? size.h) : null;

  return (
    <div
      ref={frame}
      tabIndex={0}
      role="group"
      aria-roledescription="map"
      aria-label={
        graph
          ? `${graph.title}. Escape goes back to the whole map.`
          : `${label}. Arrow keys move it, plus and minus zoom, nought shows the whole map.`
      }
      className={cn(
        'relative w-full touch-none overflow-hidden rounded-control outline-offset-2 select-none focus-visible:outline-2',
        graphH === null && 'aspect-square max-h-[75vh] sm:aspect-[16/10]',
        overName && 'cursor-pointer',
      )}
      style={{ background: SKY.groundOuter, ...(graphH !== null ? { height: graphH } : {}) }}
      onPointerDown={down}
      onPointerMove={moveTo}
      onPointerUp={up}
      onPointerCancel={cancel}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={(event) => {
        if (open) return;
        const box = event.currentTarget.getBoundingClientRect();
        zoomBy(ZOOM_STEP, { x: event.clientX - box.left, y: event.clientY - box.top });
      }}
      onKeyDown={key}
    >
      {!drawn && <FirstPaint stars={stars} />}
      <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full" />

      {cardStar && cardAt && size && <StarCard star={cardStar} at={cardAt} frame={size} asOf={asOf} />}

      {/* Drawn once the frame has grown to the graph, so it is laid out once. */}
      {graph && shownGraph && size && graphH !== null && Math.abs(size.h - graphH) <= 1 && (
        <PlaceGraph
          key={graph.key}
          graph={graph}
          stars={starOf}
          frame={size}
          from={shownGraph.from}
          selectedId={selectedId}
          pointingAt={pointingAt}
          onPick={pick}
          onOpen={openGraph}
        />
      )}

      <div
        hidden={open}
        className="absolute right-2 bottom-2 flex flex-col overflow-hidden rounded-control ring-1"
        style={{ background: SKY.panel, color: SKY.panelMuted, ['--tw-ring-color' as string]: SKY.panelRing }}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <Tooltip label="Zoom in" align="end">
          <IconButton className={ZOOM_BUTTON} label="Zoom in" onClick={() => zoomBy(ZOOM_STEP)}>
            <Plus strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip label="Zoom out" align="end">
          <IconButton className={ZOOM_BUTTON} label="Zoom out" onClick={() => zoomBy(1 / ZOOM_STEP)}>
            <Minus strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
        <Tooltip label="Show the whole map" align="end">
          <IconButton className={ZOOM_BUTTON} label="Show the whole map" onClick={showAll}>
            <Maximize2 strokeWidth={1.75} aria-hidden />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  );
}

/** Where the zoom buttons sit in the frame's corner, kept clear of names. */
const ZOOM_PANEL = (w: number, h: number): Box => ({ x: w - 56, y: h - 140, w: 56, h: 140 });

/** Zoom buttons keep the sky's light-on-dark colours whatever the theme's tokens say. */
const ZOOM_BUTTON = 'text-inherit hover:bg-white/10 hover:text-white focus-visible:outline-white';

function byIdOf(stars: readonly Star[], id: string): number {
  for (let i = 0; i < stars.length; i++) if (stars[i]!.id === id) return i;
  return -1;
}

/**
 * What the server sends before the canvas is drawn: the same sky as a plain
 * picture, the brightest stars largest, so the first paint already reads.
 */
const FIRST_PAINT_MOST = 2000;

function FirstPaint({ stars }: { stars: readonly Star[] }) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const star of stars) {
    minX = Math.min(minX, star.at.x);
    maxX = Math.max(maxX, star.at.x);
    minY = Math.min(minY, star.at.y);
    maxY = Math.max(maxY, star.at.y);
  }
  if (!Number.isFinite(minX)) return null;
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const pad = span * 0.06;
  const unit = span / 400;
  const brightest = [...stars].sort((a, b) => b.strength - a.strength).slice(0, FIRST_PAINT_MOST);
  return (
    <svg
      aria-hidden
      className="absolute inset-0 size-full"
      viewBox={`${minX - pad} ${-maxY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {brightest.map((star) =>
        star.strength > 0 ? (
          <circle
            key={star.id}
            cx={star.at.x}
            cy={-star.at.y}
            r={unit * (1.6 + 2.5 * Math.sqrt(star.strength))}
            style={{ fill: starColour(star.slot), opacity: 0.45 + 0.55 * star.strength }}
          />
        ) : (
          <circle key={star.id} cx={star.at.x} cy={-star.at.y} r={unit * 1.1} style={{ fill: SKY.unlit }} />
        ),
      )}
    </svg>
  );
}

/** The card beside a star pointed at: its state, evidence, when it was last shown and when it next halves. */
function StarCard({
  star,
  at,
  frame,
  asOf,
}: {
  star: Star;
  at: Point;
  frame: { w: number; h: number };
  asOf: string;
}) {
  const width = Math.min(260, frame.w - 16);
  const left = at.x + 16 + width > frame.w - 8 ? Math.max(8, at.x - 16 - width) : at.x + 16;
  const below = at.y < frame.h / 2;
  const row = star.stateRow;
  const setAt = row ? stateSetAt(row) : null;
  const halves = row ? halvesOn(row, new Date(asOf)) : null;
  const facts: [string, string][] = [['State', STATE_MARK_LABEL[markOf(star.state)]]];
  if (row && star.state !== 'unknown') facts.push(['Evidence', EVIDENCE_TEXT[row.established]]);
  if (star.backedBy) facts.push(['Backed by', star.backedBy]);
  if (star.strength > 0) facts.push(['Strength', `${Math.round(star.strength * 100)}%`]);
  if (setAt) facts.push(['Last shown', whenDate(setAt, { timeZone: 'UTC' })]);
  if (halves) facts.push(['Next halves', whenDate(halves, { timeZone: 'UTC' })]);
  if (star.strength <= 0 && star.exposure > 0.05) facts.push(['Halo', 'Met, not tested yet']);
  if (star.strength <= 0 && star.haze > 0.05) facts.push(['Near', 'What you know']);

  return (
    <div
      className="pointer-events-none absolute rounded-control p-3 text-small ring-1"
      style={{
        background: SKY.panel,
        color: SKY.panelText,
        ['--tw-ring-color' as string]: SKY.panelRing,
        left,
        width, ...(below ? { top: at.y + 12 } : { bottom: frame.h - at.y + 12 }),
      }}
      role="status"
    >
      <p className="text-ui font-medium">{star.name}</p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {facts.map(([term, value]) => (
          <div key={term} className="contents">
            <dt style={{ color: SKY.panelMuted }}>{term}</dt>
            <dd className="tabular text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
