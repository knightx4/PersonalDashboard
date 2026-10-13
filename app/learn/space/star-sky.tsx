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
  type Box,
  type Camera,
  type NameCandidate,
  type PlacedName,
} from '@/lib/learn/map/sky';
import { STATE_MARK_LABEL, markOf } from '@/lib/learn/map/view';
import { halvesOn, stateSetAt, type StrengthInput } from '@/lib/learn/strength';
import { usePick } from './pick';

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
 */

export type Star = {
  id: string;
  name: string;
  /** Where the current layout puts it, in the layout's units. */
  at: Point;
  state: KnowledgeState;
  stateRow: StrengthInput | null;
  strength: number;
  haze: number;
  /** The domain's colour slot, `other` for a domain without one, `none` for no domain. */
  slot: number | 'other' | 'none';
  domainId: string | null;
  neighbours: string[];
};

/** A name for the zoomed-out sky: a place, or a domain while no place is named. */
export type SkyName = { id: string; text: string; at: Point; weight: number };

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

const PLACE_FONT = '400 11px';
const IDEA_FONT = '400 11px';
const FOCUS_FONT = '600 13px';
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

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

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
}: {
  stars: readonly Star[];
  names: readonly SkyName[];
  /** Vault notes, in the layout's units. */
  dust: readonly Point[];
  /** The moment the strengths are for, as an ISO string. */
  asOf: string;
  /** What the map is, for a screen reader. */
  label: string;
  /** The gallery draws the card held open over this idea. */
  pointingAt?: string | null;
}) {
  const { selectedId, pick, params, clearDomain } = usePick();
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

  const byId = useMemo(() => new Map(stars.map((star, i) => [star.id, i])), [stars]);
  const focusId = hover?.id ?? pointingAt ?? selectedId;
  const focusIndex = focusId ? (byId.get(focusId) ?? -1) : -1;

  // Kept for the draw, which runs outside React.
  const latest = useRef({ stars, names, dust, focusIndex, domain: params.domain, size, pointingAt });
  useEffect(() => {
    latest.current = { stars, names, dust, focusIndex, domain: params.domain, size, pointingAt };
  });

  // -- Measuring the frame --------------------------------------------------
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      setSize(box.width > 0 && box.height > 0 ? { w: Math.round(box.width), h: Math.round(box.height) } : null);
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
    const { stars, names, dust, focusIndex, domain, size, pointingAt } = latest.current;
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

    // Who stands out: the idea in focus and its six nearest, or the domain picked in the legend.
    const focus = focusIndex >= 0 ? stars[focusIndex] : undefined;
    const near = new Set(focus?.neighbours ?? []);
    const litUp = (star: Star) =>
      focus ? star.id === focus.id || near.has(star.id) : domain ? star.domainId === domain : true;

    // A crowded view would add up to white, so the glow and haze thin out
    // with how many stars are in view, and come back as you zoom in.
    let inView = 0;
    for (let i = 0; i < stars.length; i++) {
      const x = sx(px[i]!);
      const y = sy(py[i]!);
      if (x >= 0 && y >= 0 && x <= w && y <= h) inView += 1;
    }
    const crowd = crowding(inView);

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
    const squares = new Map<string, number[]>();
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i]!;
      const x = sx(px[i]!);
      const y = sy(py[i]!);
      const look = starLook(star.strength, star.haze, zoom);
      const reach = Math.max(look.glow, look.haze) / 2 + 2;
      if (x < -reach || y < -reach || x > w + reach || y > h + reach) continue;
      const dim = litUp(star) ? 1 : FADED;
      if (look.haze > 0 && hazeSprite.current && look.hazeAlpha * dim * crowd >= FAINTEST_GLOW) {
        glow.globalAlpha = look.hazeAlpha * dim * crowd;
        glow.drawImage(hazeSprite.current, x - look.haze / 2, y - look.haze / 2, look.haze, look.haze);
      }
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
      ctx.globalAlpha = pass ? 1 : FADED;
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

    // An idea held wrongly wears a ring, faded with the rest outside the
    // focus or the domain picked out.
    ctx.strokeStyle = SKY.mixedUp;
    ctx.lineWidth = 1;
    for (const pass of [true, false]) {
      ctx.globalAlpha = Math.max(0.2, crowd) * (pass ? 1 : FADED);
      ctx.beginPath();
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i]!;
        if (star.state !== 'misconception' || litUp(star) !== pass) continue;
        const x = sx(px[i]!);
        const y = sy(py[i]!);
        if (x < -8 || y < -8 || x > w + 8 || y > h + 8) continue;
        ctx.moveTo(x + 5, y);
        ctx.arc(x, y, 5, 0, Math.PI * 2);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // The idea in focus: threads to its six nearest and rings round them.
    const taken: Box[] = [];
    if (focus) {
      const fx = sx(px[focusIndex]!);
      const fy = sy(py[focusIndex]!);
      ctx.strokeStyle = SKY.thread;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const id of focus.neighbours) {
        const j = byIdOf(stars, id);
        if (j < 0) continue;
        ctx.moveTo(fx, fy);
        ctx.lineTo(sx(px[j]!), sy(py[j]!));
      }
      ctx.stroke();
      ctx.strokeStyle = SKY.ring;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (const id of focus.neighbours) {
        const j = byIdOf(stars, id);
        if (j < 0) continue;
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
      const x = sx(px[i]!);
      const y = sy(py[i]!);
      if (x < -10 || y < -10 || x > w + 10 || y > h + 10) continue;
      marks.add(x, y, starLook(stars[i]!.strength, 0, zoom).core / 2);
    }
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
    const write = (placed: PlacedName[], font: string, colour: string) => {
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
    if (zoom < IDEA_NAMES_FROM) {
      const candidates: NameCandidate[] = names.map((name) => ({
        id: name.id,
        text: name.text,
        at: { x: sx(name.at.x), y: sy(name.at.y) },
        priority: name.weight,
        width: measure(PLACE_FONT, name.text),
        gap: 0,
      }));
      write(
        placeNames(candidates, w, h, NAME_LINE, taken, MAX_PLACE_NAMES, (box) => marks.covers(box)),
        PLACE_FONT,
        SKY.placeName,
      );
    } else {
      const candidates: NameCandidate[] = [];
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i]!;
        if (i === focusIndex || (focus && !litUp(star))) continue;
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
      if (first || reducedMotion()) camera.current = fit;
      else flight.current = { from: camera.current!, to: fit, start: performance.now(), ms: MOVE_MS };
    }
    redraw();
    // Size changes are handled below; only the stars refit the camera here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stars, redraw]);

  // A new frame size keeps the view's middle and refits the scale's floor.
  useEffect(() => {
    if (!size) return;
    const fit = fitCamera(stars.map((star) => star.at), size.w, size.h);
    if (!camera.current) camera.current = fit;
    else camera.current = { ...camera.current, k: camera.current.k * (fit.k / fitK.current) };
    fitK.current = fit.k;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, redraw]);

  // Anything else drawn changed: the focus, the domain picked out, the names.
  useEffect(() => {
    redraw();
  }, [focusIndex, params.domain, names, dust, redraw]);

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

  const showAll = useCallback(() => {
    if (!size) return;
    flyTo(fitCamera(stars.map((star) => star.at), size.w, size.h));
  }, [flyTo, size, stars]);

  // An idea opened from the rail is brought into view if it is off the edge.
  useEffect(() => {
    if (!selectedId || !camera.current || !size) return;
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
      if (!camera.current || !latest.current.size) return;
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
    for (let i = 0; i < xs.length; i++) {
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

  const down = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const at = local(event);
    pointers.current.set(event.pointerId, at);
    if (pointers.current.size === 1) gesture.current = { start: at, moved: false, pinched: false };
    else gesture.current.pinched = true;
    flight.current = null;
  };

  const moveTo = (event: React.PointerEvent<HTMLDivElement>) => {
    const at = local(event);
    const last = pointers.current.get(event.pointerId);
    if (!last) {
      // A mouse passing over: the star under it is pointed at.
      if (event.pointerType !== 'mouse') return;
      const i = nearest(at, POINT_REACH);
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
  const held = pointingAt ? byId.get(pointingAt) : undefined;
  const cardStar = hover ? stars[byId.get(hover.id) ?? -1] : held !== undefined && heldAt ? stars[held] : undefined;
  const cardAt = hover ?? heldAt;

  return (
    <div
      ref={frame}
      tabIndex={0}
      role="group"
      aria-roledescription="map"
      aria-label={`${label}. Arrow keys move it, plus and minus zoom, nought shows the whole map.`}
      className="relative aspect-square max-h-[75vh] w-full touch-none overflow-hidden rounded-control outline-offset-2 select-none focus-visible:outline-2 sm:aspect-[16/10]"
      style={{ background: SKY.groundOuter }}
      onPointerDown={down}
      onPointerMove={moveTo}
      onPointerUp={up}
      onPointerCancel={cancel}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={(event) => {
        const box = event.currentTarget.getBoundingClientRect();
        zoomBy(ZOOM_STEP, { x: event.clientX - box.left, y: event.clientY - box.top });
      }}
      onKeyDown={key}
    >
      {!drawn && <FirstPaint stars={stars} />}
      <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full" />

      {cardStar && cardAt && size && <StarCard star={cardStar} at={cardAt} frame={size} asOf={asOf} />}

      <div
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
  if (star.strength > 0) facts.push(['Strength', `${Math.round(star.strength * 100)}%`]);
  if (setAt) facts.push(['Last shown', DATE.format(setAt)]);
  if (halves) facts.push(['Next halves', DATE.format(halves)]);
  if (star.strength <= 0 && star.haze > 0.05) facts.push(['Near', 'Ideas you know']);

  return (
    <div
      className="pointer-events-none absolute rounded-control p-3 text-small shadow-md ring-1"
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
