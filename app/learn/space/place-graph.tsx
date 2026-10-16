'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import type { Point } from '@/lib/learn/map/layout';
import {
  ladderText,
  nodeBox,
  readableName,
  requirementText,
  spreadGraph,
  wrapName,
  type IdeaGraph,
  type Ladder,
  type Opened,
  type SpreadNode,
} from '@/lib/learn/map/place-graph';
import { SKY, ease, overlaps, starColour } from '@/lib/learn/map/sky';
import { similarityText } from '@/lib/learn/map/view';
import type { Star } from './star-sky';

/**
 * One place opened as a graph you can read (plan #1997.7), drawn over the
 * sky once the camera has flown into it.
 *
 * Every idea in the place is a mark named in full, and lines join it to its
 * three strongest links inside the place, thicker the closer the two are.
 * Pointing at an idea shows all its links with their scores. Round the edge
 * sit the ideas next door, the strongest links out, each named with the
 * place it is in; tapping one goes there. The ideas move from where the map
 * had them into the graph, so the place keeps its rough shape.
 *
 * Each idea is a button, so the graph is read and walked from the keyboard
 * as well as by pointing.
 *
 * A goal's territory opens in the same graph (plan #2187.3), with its topics
 * as the stars. There a line means requires and points with an arrowhead at
 * the topic required; pointing at a star shows all its links, each with the
 * level it needs, and the star's own level line. Each star wears an arc for
 * how far up its ladder you are, solid as far as a graded answer showed and
 * faint beyond, a dashed ring for the goal's target with a tick at the target
 * level, and a small red ring at a level whose answer missed. Its disc is as
 * bright as the tested level alone. Tapping a star opens the graph on it.
 */

const CORE_SIZE = 13;
const NEXT_SIZE = 11.5;
const CORE_LINE = 16.25;
const NEXT_LINE = 14.4;
/** The line naming the place an idea next door is in. */
const DOOR_SIZE = 10;
const DOOR_LINE = 13;
const CORE_R = 7;
const NEXT_R = 4.5;
/** How long the ideas take to move from the map into the graph. */
const SPREAD_MS = 450;
/** A score's label on a line, in pixels, and where along the line it may sit. */
const SCORE_W = 30;
const SCORE_H = 14;
const SCORE_AT = [0.5, 0.38, 0.62, 0.28, 0.72];
/** A requirement's label tries further along its line too, since a territory's stars are bigger. */
const REQUIRES_AT = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78];
/** The dark band behind a name, so the lines under it do not run through the words. */
const NAME_GROUND = 'rgba(4, 6, 13, 0.72)';
/** A territory's star, in pixels: the whole mark with its target ring, the arc's track, and the disc. */
const LADDER_R = 15;
const TRACK_R = 10.5;
const DISC_R = 5.5;
const RING_R = 14;
/** A requirement's label is about this wide a character, in pixels, at its size. */
const LABEL_CHAR = 5.6;

type Laid = SpreadNode & { name: string; lines: string[]; door: string | null; ladder: Ladder | null };

function reducedMotion(): boolean {
  return (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function PlaceGraph({
  graph,
  stars,
  frame,
  from,
  selectedId,
  pointingAt,
  onPick,
  onOpen,
}: {
  graph: IdeaGraph;
  stars: ReadonlyMap<string, Star>;
  frame: { w: number; h: number };
  /** Where each idea was on the screen as the camera arrived, to move from; null when the graph opened with the page. */
  from: ReadonlyMap<string, Point> | null;
  selectedId: string | null;
  /** The gallery holds this idea pointed at. */
  pointingAt: string | null;
  onPick: (id: string | null) => void;
  onOpen: (opened: Opened) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [progress, setProgress] = useState(from ? 0 : 1);

  const laid = useMemo(() => {
    const context = document.createElement('canvas').getContext('2d')!;
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif';
    const narrow = frame.w < 600;
    const nodes: Laid[] = [];
    for (const id of [...graph.core, ...graph.next]) {
      const ladder = graph.ladders?.get(id) ?? null;
      const star = ladder ?? stars.get(id);
      if (!star) continue;
      const core = !graph.next.includes(id);
      const size = core ? CORE_SIZE : NEXT_SIZE;
      context.font = `400 ${size}px ${family}`;
      const name = readableName(star.name);
      const wrapped = wrapName(
        name,
        core ? (narrow ? 120 : 150) : 118,
        (text) => context.measureText(text).width,
      );
      const door = core ? null : (graph.doors.get(id)?.placeName ?? null);
      let width = Math.max(wrapped.width, ladder ? LADDER_R * 2 : 0);
      if (door) {
        context.font = `500 ${DOOR_SIZE}px ${family}`;
        width = Math.max(width, Math.min(context.measureText(door).width, 140));
      }
      nodes.push({
        id,
        core,
        name,
        lines: wrapped.lines,
        door,
        ladder,
        at: star.at,
        w: Math.ceil(width) + 8,
        h: wrapped.lines.length * (core ? CORE_LINE : NEXT_LINE) + (door ? DOOR_LINE : 0) + 4,
        r: ladder ? LADDER_R : core ? CORE_R : NEXT_R,
      });
    }
    const to = spreadGraph(nodes, graph.edges, frame.w, frame.h);
    return { nodes, to };
  }, [graph, stars, frame.w, frame.h]);

  // The ideas move from the map into the graph once, as it opens. A new frame
  // size later lays the graph out again where it stands, without moving it
  // in from the map a second time.
  useEffect(() => {
    if (!from) return;
    if (reducedMotion()) {
      const id = requestAnimationFrame(() => setProgress(1));
      return () => cancelAnimationFrame(id);
    }
    const start = performance.now();
    let id = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / SPREAD_MS);
      setProgress(t);
      if (t < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [from]);

  const e = ease(progress);
  const at = (id: string): Point => {
    const to = laid.to.get(id)!;
    const was = from?.get(id) ?? to;
    return { x: was.x + (to.x - was.x) * e, y: was.y + (to.y - was.y) * e };
  };

  const shownIds = new Set(laid.nodes.map((n) => n.id));
  const territory = graph.opened.kind === 'territory' ? graph.opened : null;
  // In a territory the topic the graph was opened on is the one picked out.
  const picked = territory
    ? shownIds.has(territory.topic)
      ? territory.topic
      : null
    : selectedId && shownIds.has(selectedId)
      ? selectedId
      : null;
  const radius = new Map(laid.nodes.map((n) => [n.id, n.r]));
  const arrow = useId();
  // Pointing shows an idea's links; on a phone, with nothing to point with, tapping does.
  const focus = hover ?? (pointingAt && shownIds.has(pointingAt) ? pointingAt : null) ?? picked;
  const lit = focus
    ? new Set([
        focus,
        ...graph.edges.filter((x) => x.a === focus || x.b === focus).flatMap((x) => [x.a, x.b]),
      ])
    : null;
  const edges = graph.edges.filter((x) => x.drawn || (focus && (x.a === focus || x.b === focus)));
  const settled = progress >= 1;

  // Each score of the idea pointed at sits on its line where it covers no
  // name or mark: the middle first, then nearer one end or the other.
  const nodeBoxes = () => laid.nodes.map((n) => nodeBox(n, at(n.id)));

  // A territory star's level line, above its mark where that is clear of
  // every other star, else under its name.
  const levelLine = (id: string | null) => {
    const n = id ? laid.nodes.find((node) => node.id === id && node.ladder) : undefined;
    if (!n?.ladder) return null;
    const text = ladderText(n.ladder);
    const w = Math.ceil(text.length * LABEL_CHAR) + 12;
    const p = at(n.id);
    const own = nodeBox(n, p);
    const others = laid.nodes.filter((other) => other.id !== n.id).map((other) => nodeBox(other, at(other.id)));
    const above = { x: p.x - w / 2, y: own.y - SCORE_H - 4, w, h: SCORE_H };
    const below = { x: p.x - w / 2, y: own.y + own.h + 3, w, h: SCORE_H };
    const box = others.some((other) => overlaps(above, other)) && !others.some((other) => overlaps(below, other))
      ? below
      : above;
    return { text, box };
  };

  const scores = (id: string | null) => {
    if (!id) return [];
    const level = levelLine(id);
    const boxes = [...nodeBoxes(), ...(level ? [level.box] : [])];
    const placed: { key: string; x: number; y: number; w: number; text: string }[] = [];
    for (const x of graph.edges.filter((edge) => edge.a === id || edge.b === id)) {
      // A territory's line to an idea next door has no score worth reading.
      if (graph.ladders && !x.requires) continue;
      const text = x.requires ? requirementText(x.requires) : similarityText(x.similarity);
      const w = x.requires ? Math.ceil(text.length * LABEL_CHAR) + 10 : SCORE_W;
      const p = at(x.a);
      const q = at(x.b);
      // What a label at `c` would cover, kept `pad` pixels clear.
      const hits = (c: Point, pad = 0) => {
        const box = { x: c.x - w / 2 - pad, y: c.y - SCORE_H / 2 - pad, w: w + 2 * pad, h: SCORE_H + 2 * pad };
        return (
          boxes.filter((other) => overlaps(box, other)).length +
          placed.filter((other) =>
            overlaps(box, {
              x: other.x - other.w / 2,
              y: other.y - SCORE_H / 2,
              w: other.w,
              h: SCORE_H,
            }),
          ).length
        );
      };
      if (x.requires) {
        // Along the line first, then beside it; with nowhere clear, the spot
        // that covers least.
        const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        const nx = -(q.y - p.y) / d;
        const ny = (q.x - p.x) / d;
        const along = REQUIRES_AT.map((t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }));
        const beside = [1, 2].flatMap((k) =>
          along.flatMap((c) => [1, -1].map((s) => ({ x: c.x + s * k * nx * (SCORE_H + 3), y: c.y + s * k * ny * (SCORE_H + 3) }))),
        );
        let best = along[0]!;
        let fewest = Infinity;
        for (const c of [...along, ...beside]) {
          const n = hits(c, 3);
          if (n < fewest) [best, fewest] = [c, n];
          if (n === 0) break;
        }
        placed.push({ key: `s:${x.a}:${x.b}`, ...best, w, text });
        continue;
      }
      for (const t of SCORE_AT) {
        const c = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
        const clear = hits(c) === 0;
        if (!clear && t !== SCORE_AT[SCORE_AT.length - 1]) continue;
        // With nowhere clear, the score still shows, at the last place tried.
        placed.push({ key: `s:${x.a}:${x.b}`, ...c, w, text });
        break;
      }
    }
    return placed;
  };

  return (
    <div
      className="absolute inset-0"
      role="group"
      aria-label={`${graph.title}, as a graph of its ideas`}
    >
      <svg aria-hidden className="absolute inset-0 size-full" viewBox={`0 0 ${frame.w} ${frame.h}`}>
        {graph.ladders && (
          <defs>
            {(['rest', 'hot'] as const).map((kind) => (
              <marker
                key={kind}
                id={`${arrow}-${kind}`}
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerUnits="userSpaceOnUse"
                markerWidth="9"
                markerHeight="9"
                orient="auto"
              >
                <path d="M0,1 L10,5 L0,9 z" fill={kind === 'hot' ? SKY.ring : SKY.thread} />
              </marker>
            ))}
          </defs>
        )}
        {edges.map((x) => {
          let p = at(x.a);
          let q = at(x.b);
          const hot = focus !== null && (x.a === focus || x.b === focus);
          if (x.requires) {
            // A requirement runs from mark edge to mark edge, so its arrowhead shows.
            const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
            const ux = (q.x - p.x) / d;
            const uy = (q.y - p.y) / d;
            const ra = (radius.get(x.a) ?? 0) + 1;
            const rb = (radius.get(x.b) ?? 0) + 2;
            if (d > ra + rb) {
              p = { x: p.x + ux * ra, y: p.y + uy * ra };
              q = { x: q.x - ux * rb, y: q.y - uy * rb };
            }
          }
          return (
            <line
              key={`${x.a}:${x.b}`}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              stroke={hot ? SKY.ring : SKY.thread}
              strokeWidth={x.requires ? (hot ? 1.8 : 1.3) : 0.6 + Math.max(0, x.similarity - 0.5) * 9}
              strokeLinecap="round"
              strokeDasharray={x.out ? '2 4' : undefined}
              markerEnd={x.requires ? `url(#${arrow}-${hot ? 'hot' : 'rest'})` : undefined}
              opacity={(hot ? 1 : focus ? 0.12 : x.out ? 0.55 : 0.8) * e}
            />
          );
        })}
      </svg>

      {laid.nodes.map((n) => {
        const star = stars.get(n.id);
        const p = at(n.id);
        const cold = lit !== null && !lit.has(n.id);
        const door = n.core ? null : graph.doors.get(n.id);
        return (
          <button
            key={n.id}
            type="button"
            className="absolute flex cursor-pointer flex-col items-center rounded-control text-center outline-offset-2 focus-visible:outline-2"
            style={{
              left: p.x - n.w / 2,
              top: p.y - n.r - 3,
              width: n.w,
              opacity: cold ? 0.3 : 1,
              outlineColor: SKY.ring,
            }}
            aria-label={
              n.ladder
                ? ladderLabel(n.ladder, graph, laid.nodes)
                : n.core
                ? n.name
                : door?.placeName
                  ? `${n.name}, in ${door.placeName}. Opens that place.`
                  : `${n.name}. Opens its neighbourhood.`
            }
            aria-pressed={n.core ? picked === n.id : undefined}
            onPointerEnter={() => setHover(n.id)}
            onPointerLeave={() => setHover((was) => (was === n.id ? null : was))}
            onFocus={() => setHover(n.id)}
            onBlur={() => setHover((was) => (was === n.id ? null : was))}
            onClick={() => {
              if (territory && n.core) onOpen({ ...territory, topic: n.id });
              else if (n.core) onPick(picked === n.id ? null : n.id);
              else if (door) onOpen(door.opened);
            }}
          >
            {n.ladder ? (
              <LadderMark ladder={n.ladder} picked={picked === n.id} />
            ) : (
              star && <Mark star={star} r={n.r} picked={picked === n.id} />
            )}
            <span
              aria-hidden
              className="mt-0.5 block max-w-full rounded-control px-1"
              style={{
                fontSize: n.core ? CORE_SIZE : NEXT_SIZE,
                lineHeight: `${n.core ? CORE_LINE : NEXT_LINE}px`,
                color: n.core ? SKY.ideaName : SKY.placeName,
                background: NAME_GROUND,
                textShadow: `0 0 3px ${SKY.groundOuter}`,
                opacity: n.core ? 1 : 0.85,
              }}
            >
              {n.lines.map((line, i) => (
                <span key={i} className="block whitespace-nowrap">
                  {line}
                </span>
              ))}
              {n.door && (
                <span
                  className="block truncate font-medium"
                  style={{
                    fontSize: DOOR_SIZE,
                    lineHeight: `${DOOR_LINE}px`,
                    color: SKY.placeName,
                    opacity: 0.8,
                  }}
                >
                  {n.door}
                </span>
              )}
            </span>
          </button>
        );
      })}

      {settled &&
        [levelLine(focus)].map(
          (level) =>
            level && (
              <span
                key="level"
                aria-hidden
                className="tabular pointer-events-none absolute rounded-pill text-center whitespace-nowrap"
                style={{
                  left: level.box.x,
                  top: level.box.y,
                  width: level.box.w,
                  fontSize: 10.5,
                  lineHeight: `${SCORE_H}px`,
                  background: SKY.groundOuter,
                  color: SKY.focusName,
                }}
              >
                {level.text}
              </span>
            ),
        )}

      {settled &&
        scores(focus).map(({ key, x, y, text }) => (
          <span
            key={key}
            aria-hidden
            className="tabular pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-pill px-1 whitespace-nowrap"
            style={{
              left: x,
              top: y,
              fontSize: 10.5,
              lineHeight: `${SCORE_H}px`,
              background: SKY.groundOuter,
              color: SKY.focusName,
            }}
          >
            {text}
          </span>
        ))}
    </div>
  );
}

/** An idea's mark: as bright as you know it, in its domain's colour; a ring for one not known yet. */
function Mark({ star, r, picked }: { star: Star; r: number; picked: boolean }) {
  const colour = starColour(star.slot);
  const s = Math.min(Math.max(star.strength, 0), 1);
  const lit = s > 0;
  const ring = star.state === 'misconception' ? SKY.mixedUp : SKY.unlit;
  const glow = lit
    ? `0 0 ${4 + 12 * s}px ${colour}`
    : star.haze > 0.02
      ? `0 0 10px rgba(${SKY.haze.join(',')},${(0.2 + 0.4 * star.haze).toFixed(2)})`
      : 'none';
  return (
    <span
      aria-hidden
      className="block shrink-0 rounded-full"
      style={{
        width: r * 2,
        height: r * 2,
        background: lit ? colour : 'transparent',
        opacity: lit ? 0.5 + 0.5 * s : 1,
        border:
          lit && star.state !== 'misconception'
            ? 'none'
            : `1.5px solid ${lit ? SKY.mixedUp : ring}`,
        boxShadow: picked ? `0 0 0 2px ${SKY.groundOuter}, 0 0 0 3.5px ${SKY.ring}, ${glow}` : glow,
      }}
    />
  );
}

/** What a territory's star says to a screen reader: its level, target, misses and what it requires. */
function ladderLabel(ladder: Ladder, graph: IdeaGraph, nodes: readonly Laid[]): string {
  const name = new Map(nodes.map((n) => [n.id, n.name]));
  const needs = graph.edges
    .filter((x) => x.requires && x.a === ladder.id)
    .map((x) => `${name.get(x.b) ?? ''} at level ${x.requires!.binds.map((b) => b.needs).join(' or ')}`);
  const parts = [`${ladder.name}. ${ladderText(ladder)}.`];
  if (ladder.missed.length > 0) parts.push(`Missed level ${ladder.missed.join(' and ')}.`);
  if (needs.length > 0) parts.push(`Requires ${needs.join('; ')}.`);
  return parts.join(' ');
}

/** A point on a circle of radius `r` round the middle of the mark's box, a share `f` of the way round from the top. */
function round(f: number, r: number): { x: number; y: number } {
  const a = -Math.PI / 2 + f * Math.PI * 2;
  return { x: LADDER_R + r * Math.cos(a), y: LADDER_R + r * Math.sin(a) };
}

/** The arc from the top, clockwise, a share `f` of the way round. */
function arcPath(f: number, r: number): string {
  if (f <= 0) return '';
  const end = round(Math.min(f, 0.9999), r);
  const start = round(0, r);
  return `M${start.x},${start.y} A${r},${r} 0 ${f > 0.5 ? 1 : 0} 1 ${end.x},${end.y}`;
}

/**
 * A territory's star: a disc as bright as the tested level, an arc on its
 * track as far as you hold, a dashed ring with a tick at the target, and a
 * small red ring at each level missed.
 */
function LadderMark({ ladder, picked }: { ladder: Ladder; picked: boolean }) {
  const colour = starColour(ladder.slot);
  const top = Math.max(ladder.ceiling, 1);
  const tested = Math.min(ladder.tested, top) / top;
  const held = Math.min(Math.max(ladder.held, ladder.tested), top) / top;
  const lit = tested > 0;
  const size = LADDER_R * 2;
  const tick = ladder.target !== null ? Math.min(ladder.target, top) / top : null;
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="block shrink-0 overflow-visible"
    >
      {ladder.target !== null && (
        <circle
          cx={LADDER_R}
          cy={LADDER_R}
          r={RING_R}
          fill="none"
          stroke={SKY.ring}
          strokeWidth={1}
          strokeDasharray="2.2 2.4"
          opacity={0.75}
        />
      )}
      <circle cx={LADDER_R} cy={LADDER_R} r={TRACK_R} fill="none" stroke={SKY.thread} strokeWidth={2} opacity={0.3} />
      {held > tested && (
        <path d={arcPath(held, TRACK_R)} fill="none" stroke={colour} strokeWidth={2} strokeLinecap="round" opacity={0.45} />
      )}
      {lit && <path d={arcPath(tested, TRACK_R)} fill="none" stroke={colour} strokeWidth={2.2} strokeLinecap="round" />}
      {tick !== null && (
        <line
          x1={round(tick, TRACK_R - 2.5).x}
          y1={round(tick, TRACK_R - 2.5).y}
          x2={round(tick, RING_R + 1).x}
          y2={round(tick, RING_R + 1).y}
          stroke={SKY.ring}
          strokeWidth={1.4}
          strokeLinecap="round"
        />
      )}
      {ladder.missed.map((level) => {
        const c = round((Math.min(level, top) - 0.5) / top, TRACK_R);
        return (
          <circle key={level} cx={c.x} cy={c.y} r={2.4} fill={SKY.groundOuter} stroke={SKY.mixedUp} strokeWidth={1.4} />
        );
      })}
      {picked && <circle cx={LADDER_R} cy={LADDER_R} r={DISC_R + 2.5} fill="none" stroke={SKY.ring} strokeWidth={1.5} />}
      <circle
        cx={LADDER_R}
        cy={LADDER_R}
        r={DISC_R}
        fill={lit ? colour : 'transparent'}
        fillOpacity={lit ? 0.45 + 0.55 * tested : 1}
        stroke={lit ? 'none' : SKY.unlit}
        strokeWidth={1.5}
        style={lit ? { filter: `drop-shadow(0 0 ${3 + 6 * tested}px ${colour})` } : undefined}
      />
    </svg>
  );
}
