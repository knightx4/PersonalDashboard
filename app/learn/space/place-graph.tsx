'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Point } from '@/lib/learn/map/layout';
import {
  nodeBox,
  readableName,
  spreadGraph,
  wrapName,
  type IdeaGraph,
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
/** The dark band behind a name, so the lines under it do not run through the words. */
const NAME_GROUND = 'rgba(4, 6, 13, 0.72)';

type Laid = SpreadNode & { name: string; lines: string[]; door: string | null };

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
      const star = stars.get(id);
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
      let width = wrapped.width;
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
        at: star.at,
        w: Math.ceil(width) + 8,
        h: wrapped.lines.length * (core ? CORE_LINE : NEXT_LINE) + (door ? DOOR_LINE : 0) + 4,
        r: core ? CORE_R : NEXT_R,
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
  const picked = selectedId && shownIds.has(selectedId) ? selectedId : null;
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
  const scores = (id: string | null) => {
    if (!id) return [];
    const boxes = laid.nodes.map((n) => nodeBox(n, at(n.id)));
    const placed: { key: string; x: number; y: number; text: string }[] = [];
    for (const x of graph.edges.filter((edge) => edge.a === id || edge.b === id)) {
      const p = at(x.a);
      const q = at(x.b);
      for (const t of SCORE_AT) {
        const c = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
        const box = { x: c.x - SCORE_W / 2, y: c.y - SCORE_H / 2, w: SCORE_W, h: SCORE_H };
        const clear =
          !boxes.some((other) => overlaps(box, other)) &&
          !placed.some((other) =>
            overlaps(box, {
              x: other.x - SCORE_W / 2,
              y: other.y - SCORE_H / 2,
              w: SCORE_W,
              h: SCORE_H,
            }),
          );
        if (!clear && t !== SCORE_AT[SCORE_AT.length - 1]) continue;
        // With nowhere clear, the score still shows, at the last place tried.
        placed.push({ key: `s:${x.a}:${x.b}`, ...c, text: similarityText(x.similarity) });
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
        {edges.map((x) => {
          const p = at(x.a);
          const q = at(x.b);
          const hot = focus !== null && (x.a === focus || x.b === focus);
          return (
            <line
              key={`${x.a}:${x.b}`}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              stroke={hot ? SKY.ring : SKY.thread}
              strokeWidth={0.6 + Math.max(0, x.similarity - 0.5) * 9}
              strokeLinecap="round"
              strokeDasharray={x.out ? '2 4' : undefined}
              opacity={(hot ? 1 : focus ? 0.12 : x.out ? 0.55 : 0.8) * e}
            />
          );
        })}
      </svg>

      {laid.nodes.map((n) => {
        const star = stars.get(n.id)!;
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
              n.core
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
              if (n.core) onPick(picked === n.id ? null : n.id);
              else if (door) onOpen(door.opened);
            }}
          >
            <Mark star={star} r={n.r} picked={picked === n.id} />
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
        scores(focus).map(({ key, x, y, text }) => (
          <span
            key={key}
            aria-hidden
            className="tabular pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-pill px-1"
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
