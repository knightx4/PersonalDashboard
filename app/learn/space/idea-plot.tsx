'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { Point } from '@/lib/learn/map/layout';
import { hueFill, type AxisEnds, type MapColour, type StateMark } from '@/lib/learn/map/view';
import { usePick } from './pick';

/**
 * The Idea Space map itself (plan #1857): every embedded idea as a mark.
 *
 * Redrawn on 13 October to work the way the sketch built in chat on 12
 * October does, which the person preferred to the two builds before it:
 *
 * - The frame is measured and the SVG is drawn in its own pixels, so a dot is
 *   the same size at every width and the layout is fitted to the frame with
 *   one scale. The frame is wide on a laptop and square on a phone, and never
 *   taller than three quarters of the window, where the square it used to be
 *   ran off the bottom of a wide screen.
 * - Pointing at an idea shows it at once: everything but it and its six
 *   nearest fades, lines join them and rings mark the six. A tap or click
 *   pins it, and the rail follows. Nothing waits on the server.
 * - Switching layout moves every dot to its new place, so the eye can follow
 *   a group from one layout to the other.
 *
 * Names stay HTML over the SVG so they are the same size at every width, and
 * one is drawn only where it covers no dot and no other name (Part 10, rule 4).
 */

export type PlotDot = {
  id: string;
  name: string;
  /** Where the current layout puts it, in the layout's own units. */
  at: Point;
  mark: StateMark;
  /** The domain's colour slot, `other` for a domain without one, `none` for no domain. */
  slot: number | 'other' | 'none';
  domainId: string | null;
  neighbours: string[];
};

export type PlotArea = {
  id: string;
  text: string;
  kind: 'field' | 'domain';
  at: Point;
  priority: number;
  /** Ideas on the map under it. A field with none is ground not visited yet. */
  visited: boolean;
};

/** How close a pointer has to come to a dot to point at it, and a finger to tap it, in pixels. */
const POINT_REACH = 14;
const TAP_REACH = 22;

/** The gap kept between the outermost dots and the frame's edge, in pixels. */
const INSET = 22;
/** Room kept above and below for the axis names, in pixels. */
const AXIS_BAND = 24;

/** How many field and domain names show at once (Part 10, rule 4). */
export const NAMES_SHOWN = 7;

/** A name's rough width per character and its line height, for keeping names apart. */
const CHAR_PX = 6.6;
const LINE_PX = 18;

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** One scale for both directions, so distances keep their proportions. */
function fitter(points: readonly Point[], width: number, height: number, band: number) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) return () => ({ x: width / 2, y: height / 2 });
  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const innerW = Math.max(width - 2 * INSET, 1);
  const innerH = Math.max(height - 2 * (INSET + band), 1);
  const scale = Math.min(innerW / spanX, innerH / spanY);
  const ox = (width - scale * spanX) / 2;
  const oy = (height - scale * spanY) / 2;
  // Up in the layout is up on the screen.
  return (p: Point) => ({
    x: ox + (Math.min(Math.max(p.x, minX), maxX) - minX) * scale,
    y: height - (oy + (Math.min(Math.max(p.y, minY), maxY) - minY) * scale),
  });
}

export function IdeaPlot({
  dots,
  areas,
  axes,
  colour,
}: {
  dots: readonly PlotDot[];
  /** Null when the names are off. */
  areas: readonly PlotArea[] | null;
  /** What each end of the main axes is about; null on the neighbour map. */
  axes: AxisEnds | null;
  colour: MapColour;
}) {
  const { selectedId, pick, params, clearDomain } = usePick();
  const [pointing, setPointing] = useState<string | null>(null);
  const frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      setSize(box.width > 0 && box.height > 0 ? { w: box.width, h: box.height } : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const byId = useMemo(() => new Map(dots.map((dot) => [dot.id, dot])), [dots]);

  const band = axes ? AXIS_BAND : 0;
  const placed = useMemo(() => {
    if (!size) return null;
    const fit = fitter(
      dots.map((dot) => dot.at),
      size.w,
      size.h,
      band,
    );
    return new Map(dots.map((dot) => [dot.id, fit(dot.at)]));
  }, [dots, size, band]);

  const areaAt = useMemo(() => {
    if (!size || !areas) return null;
    const fit = fitter(
      dots.map((dot) => dot.at),
      size.w,
      size.h,
      band,
    );
    return new Map(areas.map((area) => [area.id, fit(area.at)]));
  }, [areas, dots, size, band]);

  // What is shown: the idea pointed at, else the one pinned.
  const focusId = pointing ?? selectedId;
  const focus = focusId ? (byId.get(focusId) ?? null) : null;
  const near = useMemo(() => new Set(focus?.neighbours ?? []), [focus]);
  const domain = colour === 'domain' && !focus ? params.domain : null;
  const lit = (dot: PlotDot) =>
    focus ? dot.id === focus.id || near.has(dot.id) : domain ? dot.domainId === domain : true;

  // The focused idea's name over its dot, or under it when over leaves the frame.
  const focusName = useMemo(() => {
    if (!focus || !placed || !size) return null;
    const p = placed.get(focus.id)!;
    const w = Math.min(focus.name.length * CHAR_PX + 16, 300);
    const x = Math.min(Math.max(p.x - w / 2, 4), size.w - w - 4);
    const above = p.y - 14 - LINE_PX >= 2;
    return { x, y: above ? p.y - 14 - LINE_PX : p.y + 14, w };
  }, [focus, placed, size]);

  // Field and domain names: most important first, each only where it covers
  // no dot and no name already down, at most seven.
  const names = useMemo(() => {
    if (!areas || !areaAt || !placed || !size) return [];
    const taken: Box[] = focusName
      ? [{ x: focusName.x, y: focusName.y, w: focusName.w, h: LINE_PX }]
      : [];
    const dotsAt = [...placed.values()];
    const out: { area: PlotArea; box: Box }[] = [];
    for (const area of [...areas].sort((a, b) => b.priority - a.priority)) {
      if (out.length === NAMES_SHOWN) break;
      const p = areaAt.get(area.id)!;
      const w = area.text.length * CHAR_PX + 8;
      for (const dy of [0, -16, 16, -30, 30]) {
        const box = { x: p.x - w / 2, y: p.y - LINE_PX / 2 + dy, w, h: LINE_PX };
        if (box.x < 2 || box.y < 2 || box.x + w > size.w - 2 || box.y + LINE_PX > size.h - 2)
          continue;
        if (taken.some((other) => overlaps(box, other))) continue;
        const pad = { x: box.x - 4, y: box.y - 3, w: box.w + 8, h: box.h + 6 };
        if (
          dotsAt.some(
            (d) => d.x > pad.x && d.x < pad.x + pad.w && d.y > pad.y && d.y < pad.y + pad.h,
          )
        )
          continue;
        taken.push(box);
        out.push({ area, box });
        break;
      }
    }
    return out;
  }, [areas, areaAt, placed, size, focusName]);

  const nearest = (event: React.PointerEvent<HTMLDivElement>, reach: number): PlotDot | null => {
    if (!placed) return null;
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - box.left;
    const y = event.clientY - box.top;
    let best: PlotDot | null = null;
    let bestDistance = reach * reach;
    for (const dot of dots) {
      const p = placed.get(dot.id)!;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d <= bestDistance) {
        best = dot;
        bestDistance = d;
      }
    }
    return best;
  };

  const press = (event: React.PointerEvent<HTMLDivElement>) => {
    const dot = nearest(event, event.pointerType === 'mouse' ? POINT_REACH : TAP_REACH);
    if (!dot && !selectedId) {
      // Empty ground lets go of a domain picked out in the legend too.
      if (domain) clearDomain();
      return;
    }
    pick(dot ? dot.id : null);
  };

  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    const id = nearest(event, POINT_REACH)?.id ?? null;
    if (id !== pointing) setPointing(id);
  };

  // Drawn in this order so the dots that say most sit on top, and the
  // focused neighbourhood over everything.
  const order: Record<StateMark, number> = {
    unseen: 0,
    'getting-there': 1,
    known: 2,
    'mixed-up': 3,
  };
  const drawn = [...dots].sort((a, b) => {
    const la = focus && lit(a) ? 1 : 0;
    const lb = focus && lit(b) ? 1 : 0;
    return la - lb || order[a.mark] - order[b.mark];
  });

  const focusAt = focus && placed ? placed.get(focus.id)! : null;

  return (
    <div>
      <div
        ref={frame}
        className={cn(
          'relative aspect-square max-h-[75vh] w-full overflow-hidden sm:aspect-[16/10]',
          dots.length > 0 && 'cursor-crosshair',
        )}
        onPointerUp={press}
        onPointerMove={point}
        onPointerLeave={() => setPointing(null)}
      >
        {size && placed && (
          <svg
            width={size.w}
            height={size.h}
            viewBox={`0 0 ${size.w} ${size.h}`}
            className="absolute inset-0"
            role="img"
            aria-label={`A map of ${dots.length} ideas, each placed near the ideas most like it`}
          >
            {/* The main axes' centre lines: dashed hairlines under the marks (Part 10, rule 6). */}
            {axes && (
              <g className="stroke-border" strokeWidth={1} strokeDasharray="3 6">
                <line x1={0} y1={size.h / 2} x2={size.w} y2={size.h / 2} />
                <line x1={size.w / 2} y1={0} x2={size.w / 2} y2={size.h} />
              </g>
            )}

            {focus &&
              focusAt &&
              focus.neighbours.map((id) => {
                const other = placed.get(id);
                if (!other) return null;
                return (
                  <line
                    key={id}
                    x1={focusAt.x}
                    y1={focusAt.y}
                    x2={other.x}
                    y2={other.y}
                    className="stroke-accent"
                    strokeWidth={1.5}
                    strokeOpacity={0.8}
                  />
                );
              })}

            {drawn.map((dot) => {
              const p = placed.get(dot.id)!;
              return (
                <g
                  key={dot.id}
                  style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
                  className={cn(
                    'transition-[transform,opacity] duration-move ease-out-soft motion-reduce:transition-none',
                    !lit(dot) && 'opacity-20',
                  )}
                >
                  <MarkPx dot={dot} colour={colour} />
                  {near.has(dot.id) && (
                    <circle r={8.5} fill="none" className="stroke-accent" strokeWidth={1.5} />
                  )}
                  {focus?.id === dot.id && (
                    <circle r={9.5} fill="none" className="stroke-ink" strokeWidth={2} />
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {axes?.top && (
          <span className={cn(AXIS_NAME, 'top-1 left-1/2 -translate-x-1/2')}>↑ {axes.top}</span>
        )}
        {axes?.bottom && (
          <span className={cn(AXIS_NAME, 'bottom-1 left-1/2 -translate-x-1/2')}>
            ↓ {axes.bottom}
          </span>
        )}

        {names.map(({ area, box }) => (
          <span
            key={area.id}
            className={cn(
              'pointer-events-none absolute truncate text-center leading-[18px] text-ink-muted',
              area.kind === 'domain' ? 'text-small' : 'text-micro',
              !area.visited && 'italic',
            )}
            style={{ left: box.x, top: box.y, width: box.w }}
          >
            {area.text}
          </span>
        ))}

        {focus && focusName && (
          <span
            className="pointer-events-none absolute truncate rounded-control bg-raised px-2 text-center text-small leading-[18px] text-ink ring-1 ring-border"
            style={{ left: focusName.x, top: focusName.y, width: focusName.w }}
          >
            {focus.name}
          </span>
        )}
      </div>
      {axes && (axes.left || axes.right) && (
        <div className="flex items-start justify-between gap-4 px-2 pt-1 pb-2 text-small text-ink-muted">
          <p className="max-w-1/2 text-balance">{axes.left && <>← {axes.left}</>}</p>
          <p className="max-w-1/2 text-right text-balance">{axes.right && <>{axes.right} →</>}</p>
        </div>
      )}
    </div>
  );
}

/** The top and bottom axis names, in the bands kept clear of dots. */
const AXIS_NAME =
  'pointer-events-none absolute max-w-sm truncate text-small leading-[18px] text-ink-muted';

/** One idea's mark in pixels, centred on the origin. */
function MarkPx({ dot, colour }: { dot: Pick<PlotDot, 'mark' | 'slot'>; colour: MapColour }) {
  if (colour === 'domain') {
    if (dot.slot === 'none') {
      return <circle r={4} className="fill-surface stroke-ink-ghost" strokeWidth={1.5} />;
    }
    if (dot.slot === 'other') return <circle r={4.5} className="fill-ink-muted" />;
    return <circle r={4.5} style={{ fill: hueFill(dot.slot) }} />;
  }
  switch (dot.mark) {
    // Filled in the accent: what you know is the answer the map gives
    // (Part 10, rule 1).
    case 'known':
      return <circle r={5} className="fill-accent" />;
    case 'getting-there':
      return <circle r={4.5} className="fill-ink-muted" />;
    case 'mixed-up':
      return <path d="M0 -6L6 0L0 6L-6 0Z" className="fill-danger" />;
    // A hollow ring at nearly a known dot's size: ground not visited yet
    // (Part 10, rule 2).
    default:
      return <circle r={4} className="fill-surface stroke-ink-ghost" strokeWidth={1.5} />;
  }
}

/** One idea's mark, one unit across, for the legend and the rail. */
export function Mark({ dot, colour }: { dot: Pick<PlotDot, 'mark' | 'slot'>; colour: MapColour }) {
  if (colour === 'domain') {
    if (dot.slot === 'none') {
      return <circle r={0.8} className="fill-surface stroke-ink-ghost" strokeWidth={0.35} />;
    }
    if (dot.slot === 'other') return <circle r={1} className="fill-ink-muted" />;
    return <circle r={1} style={{ fill: hueFill(dot.slot) }} />;
  }
  switch (dot.mark) {
    case 'known':
      return <circle r={1} className="fill-accent" />;
    case 'getting-there':
      return <circle r={0.9} className="fill-ink-muted" />;
    case 'mixed-up':
      return <path d="M0 -1.3L1.3 0L0 1.3L-1.3 0Z" className="fill-danger" />;
    default:
      return <circle r={0.8} className="fill-surface stroke-ink-ghost" strokeWidth={0.3} />;
  }
}
