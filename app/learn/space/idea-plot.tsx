'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import {
  DOT_REACH_PX,
  LABEL_SHIFTS,
  anchorAt,
  hueFill,
  placeLabels,
  type AreaLabel,
  type AxisEnds,
  type MapColour,
  type StateMark,
} from '@/lib/learn/map/view';
import { usePick } from './pick';

/**
 * The Idea Space map itself (plan #1857): every embedded idea as a mark, in
 * SVG, with the field and domain names laid over it in HTML.
 *
 * The SVG stretches to the frame, so the marks are drawn at one unit and
 * scaled per width by class: a dot is about nine pixels across on a phone
 * and on a laptop alike, where scaling with the frame would make it three
 * times larger on the wider one. Names are HTML on top for the same reason,
 * since text inside a stretched SVG would shrink to nothing on a phone.
 *
 * A dot is a few pixels across, too small to press, so the map is pressed as
 * a whole and the press picks the nearest idea within a finger's reach;
 * pressing empty ground closes the open idea. The pick shows at once on the
 * map and in the rail (pick.tsx), and the address follows (law 5). With a
 * mouse, pointing names the idea under the pointer.
 *
 * Plan #1883 made it read as the map built in chat on 12 October: known ideas
 * in the accent, ideas not seen yet as rings rather than specks, everything
 * but the open idea's neighbourhood faded, the main axes' ends named, and
 * field and domain names quiet and never over a dot.
 */

export type PlotDot = {
  id: string;
  name: string;
  left: number;
  top: number;
  mark: StateMark;
  /** The domain's colour slot, `other` for a domain without one, `none` for no domain. */
  slot: number | 'other' | 'none';
  domainId: string | null;
  neighbours: string[];
};

export type PlotArea = AreaLabel & {
  /** Ideas on the map under it. A field with none is ground not visited yet. */
  visited: boolean;
};

/** A finger's reach, in CSS pixels: half the 44px press target. */
const REACH_PX = 22;

/** One unit of the 0–100 frame is drawn at this scale per width. */
const MARK_SCALE =
  '[transform-box:fill-box] origin-center scale-[1.25] sm:scale-[0.8] lg:scale-[0.65]';

/** The same scale as a number, for the window's width (the sm and lg breakpoints). */
function markScale(): number {
  if (typeof window === 'undefined') return 1.25;
  if (window.matchMedia('(min-width: 64rem)').matches) return 0.65;
  if (window.matchMedia('(min-width: 40rem)').matches) return 0.8;
  return 1.25;
}

/** The open idea's name: its rough width per character, its height, and its gap from the dot. */
const NAME_CHAR_PX = 7.4;
const NAME_LINE_PX = 22;
const NAME_GAP_PX = 12;
/** How far from its dot the open idea's name sits: half its height and the gap. */
const SELECTED_RAISE_PX = NAME_LINE_PX / 2 + NAME_GAP_PX;

/** What every mark outside the open idea's neighbourhood fades to (Part 10, rule 3). */
const FADED = 'opacity-25';

/** How many field and domain names show at once; the rest name themselves on hover (Part 10, rule 4). */
export const NAMES_SHOWN = 7;

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
  // The frame's width in pixels, measured, since where a name sits clear of
  // the dots depends on it. Until it is known no name is drawn.
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const measure = () => setWidth(element.getBoundingClientRect().width || null);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const byId = useMemo(() => new Map(dots.map((dot) => [dot.id, dot])), [dots]);
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const near = new Set(selected?.neighbours ?? []);
  // A domain pressed in the legend stands out the same way, while no idea is open.
  const domain = colour === 'domain' && !selected ? params.domain : null;
  const lit = (id: string) =>
    selected
      ? id === selected.id || near.has(id)
      : domain
        ? byId.get(id)?.domainId === domain
        : true;

  // The open idea's name sits over its dot, or under it when over would hide
  // more of the six it is shown with.
  const nameBelow = useMemo(() => {
    if (!selected || !width) return false;
    const w = Math.min(selected.name.length * NAME_CHAR_PX + 8, 320);
    const x = (selected.left / 100) * width;
    const y = (selected.top / 100) * width;
    const anchor = anchorAt(selected.left);
    const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
    const hidden = (top: number) =>
      selected.neighbours.filter((id) => {
        const other = byId.get(id);
        if (!other) return false;
        const ox = (other.left / 100) * width;
        const oy = (other.top / 100) * width;
        return ox > left - 4 && ox < left + w + 4 && oy > top - 4 && oy < top + NAME_LINE_PX + 4;
      }).length;
    return hidden(y + NAME_GAP_PX) < hidden(y - NAME_GAP_PX - NAME_LINE_PX);
  }, [selected, width, byId]);

  const placement = useMemo(() => {
    if (!areas || !width) return null;
    const fitted: AreaLabel[] = [...areas];
    // The open idea's name goes down first and every other name gives way
    // to it. The map draws it itself, so it is fitted here and left out.
    if (selected) {
      fitted.push({
        id: 'idea',
        text: selected.name,
        kind: 'idea',
        left: selected.left,
        top: selected.top,
        priority: Number.POSITIVE_INFINITY,
        raise: nameBelow ? -SELECTED_RAISE_PX : SELECTED_RAISE_PX,
      });
    }
    const reach = Math.max(DOT_REACH_PX, (markScale() * width) / 100 + 1.5);
    const kept = placeLabels(fitted, width, { dots, shifts: LABEL_SHIFTS, reach });
    // Placed most important first, so the first seven names kept are the ones shown.
    const shown = new Map<string, number>();
    for (const [id, shift] of kept) {
      if (id === 'idea') continue;
      if (shown.size === NAMES_SHOWN) break;
      shown.set(id, shift);
    }
    return shown;
  }, [areas, width, dots, selected, nameBelow]);

  const nearest = (event: React.PointerEvent<HTMLDivElement>): PlotDot | null => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return null;
    const x = ((event.clientX - box.left) / box.width) * 100;
    const y = ((event.clientY - box.top) / box.height) * 100;
    const reach = (REACH_PX / box.width) * 100;
    let best: PlotDot | null = null;
    let bestDistance = reach * reach;
    for (const dot of dots) {
      const d = (dot.left - x) ** 2 + (dot.top - y) ** 2;
      if (d <= bestDistance) {
        best = dot;
        bestDistance = d;
      }
    }
    return best;
  };

  const press = (event: React.PointerEvent<HTMLDivElement>) => {
    const dot = nearest(event);
    if (!dot && !selectedId) {
      // Empty ground lets go of a domain picked out in the legend too.
      if (domain) clearDomain();
      return;
    }
    pick(dot ? dot.id : null);
  };

  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse') return;
    setPointing(nearest(event)?.id ?? null);
  };

  const shown = pointing && pointing !== selectedId ? byId.get(pointing) : null;
  // Drawn in this order so the dots that say most sit on top.
  const order: Record<StateMark, number> = {
    unseen: 0,
    'getting-there': 1,
    known: 2,
    'mixed-up': 3,
  };
  const drawn = [...dots].sort((a, b) => order[a.mark] - order[b.mark]);

  return (
    <div>
      {axes?.top && <p className={cn(AXIS_NAME, 'px-2 pt-2 pb-1 text-center')}>↑ {axes.top}</p>}
      <div
        ref={frame}
        className={cn(
          'relative aspect-square w-full overflow-hidden',
          dots.length > 0 && 'cursor-pointer',
        )}
        onPointerUp={press}
        onPointerMove={point}
        onPointerLeave={() => setPointing(null)}
      >
        <svg
          viewBox="0 0 100 100"
          className="absolute inset-0 size-full"
          role="img"
          aria-label={`A map of ${dots.length} ideas, each placed near the ideas most like it`}
        >
          {/* The main axes' centre lines: dashed hairlines under the marks (Part 10, rule 6). */}
          {axes && (
            <g className="stroke-border" strokeWidth={1} strokeDasharray="3 5">
              <line x1={0} y1={50} x2={100} y2={50} vectorEffect="non-scaling-stroke" />
              <line x1={50} y1={0} x2={50} y2={100} vectorEffect="non-scaling-stroke" />
            </g>
          )}

          {selected &&
            selected.neighbours.map((id) => {
              const other = byId.get(id);
              if (!other) return null;
              return (
                <line
                  key={id}
                  x1={selected.left}
                  y1={selected.top}
                  x2={other.left}
                  y2={other.top}
                  className="stroke-accent"
                  strokeWidth={1.5}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}

          {drawn.map((dot) => (
            <g
              key={dot.id}
              transform={`translate(${dot.left} ${dot.top})`}
              className={cn('transition-opacity duration-quick', !lit(dot.id) && FADED)}
            >
              <g className={MARK_SCALE}>
                <Mark dot={dot} colour={colour} />
                {near.has(dot.id) && (
                  <circle r={1.7} fill="none" className="stroke-accent" strokeWidth={0.35} />
                )}
              </g>
            </g>
          ))}

          {selected && (
            <g transform={`translate(${selected.left} ${selected.top})`}>
              <g className={MARK_SCALE}>
                <Mark dot={selected} colour={colour} />
                <circle r={2.1} fill="none" className="stroke-ink" strokeWidth={0.5} />
              </g>
            </g>
          )}
        </svg>

        {placement &&
          areas?.map((area) => {
            const shift = placement.get(area.id);
            if (shift === undefined) return null;
            return (
              <MapName
                key={area.id}
                left={area.left}
                top={area.top}
                shift={shift}
                className={cn(
                  'text-ink-muted',
                  area.kind === 'domain' ? 'text-small' : 'text-micro',
                  !area.visited && 'italic',
                )}
              >
                {area.text}
              </MapName>
            );
          })}

        {selected && (
          <MapName
            left={selected.left}
            top={selected.top}
            above={!nameBelow}
            below={nameBelow}
            className="bg-raised text-small text-ink ring-1 ring-border"
          >
            {selected.name}
          </MapName>
        )}
        {shown && (
          <MapName
            left={shown.left}
            top={shown.top}
            above
            className="bg-raised text-small text-ink ring-1 ring-border"
          >
            {shown.name}
          </MapName>
        )}
      </div>
      {axes && (axes.bottom || axes.left || axes.right) && <AxisFoot axes={axes} />}
    </div>
  );
}

/** The axis-end names: small and muted, in strips outside the square the dots are drawn in. */
const AXIS_NAME = 'text-small text-ink-muted text-balance';

/**
 * What the ideas at the bottom, left and right ends of the main axes are
 * about, under the map: the bottom end centred, then the left and right ends
 * at their own sides. The top end sits over the map. Kept off the square so
 * no name covers a dot, and wrapped rather than cut, so every word shows.
 */
function AxisFoot({ axes }: { axes: AxisEnds }) {
  return (
    <div className="space-y-1 px-2 pt-1 pb-3">
      {axes.bottom && <p className={cn(AXIS_NAME, 'text-center')}>↓ {axes.bottom}</p>}
      {(axes.left || axes.right) && (
        <div className="flex items-start justify-between gap-4">
          <p className={cn(AXIS_NAME, 'max-w-1/2')}>{axes.left && <>← {axes.left}</>}</p>
          <p className={cn(AXIS_NAME, 'max-w-1/2 text-right')}>
            {axes.right && <>{axes.right} →</>}
          </p>
        </div>
      )}
    </div>
  );
}

/** A name laid over the map at a point, hanging inwards from the frame's edges. */
function MapName({
  left,
  top,
  above = false,
  below = false,
  shift = 0,
  className,
  children,
}: {
  left: number;
  top: number;
  /** Over the point rather than on it, for an idea's own name. */
  above?: boolean;
  /** Under the point, for an idea's name that would hide its neighbours from above. */
  below?: boolean;
  /** Pixels down from the point (negative is up), to sit clear of the dots. */
  shift?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const anchor = anchorAt(left);
  const x = anchor === 'start' ? '0' : anchor === 'end' ? '-100%' : '-50%';
  const y = above ? 'calc(-100% - 0.75rem)' : below ? '0.75rem' : `calc(-50% + ${shift}px)`;
  return (
    <span
      className={cn(
        'pointer-events-none absolute max-w-xs truncate rounded-control px-1 whitespace-nowrap',
        // A halo of the card's own ground rather than a box, so a name
        // stays readable over the lines without hiding them.
        '[text-shadow:0_0_2px_var(--color-surface),0_0_4px_var(--color-surface),0_0_6px_var(--color-surface)]',
        className,
      )}
      style={{ left: `${left}%`, top: `${top}%`, transform: `translate(${x}, ${y})` }}
    >
      {children}
    </span>
  );
}

/** One idea's mark, one unit across before scaling. */
export function Mark({ dot, colour }: { dot: Pick<PlotDot, 'mark' | 'slot'>; colour: MapColour }) {
  if (colour === 'domain') {
    if (dot.slot === 'none') {
      return <circle r={0.8} className="fill-surface stroke-ink-ghost" strokeWidth={0.35} />;
    }
    if (dot.slot === 'other') return <circle r={1} className="fill-ink-muted" />;
    return <circle r={1} style={{ fill: hueFill(dot.slot) }} />;
  }
  switch (dot.mark) {
    // Filled in the accent: what you know is the answer the map gives, and
    // the only thing in it drawn in the accent before an idea is picked
    // (Part 10, rule 1).
    case 'known':
      return <circle r={1} className="fill-accent" />;
    // Filled in the muted ink: on the way to known, and not yet the answer.
    case 'getting-there':
      return <circle r={0.85} className="fill-ink-muted" />;
    case 'mixed-up':
      return <path d="M0 -1.3L1.3 0L0 1.3L-1.3 0Z" className="fill-danger" />;
    // A hollow ring at nearly a known dot's size: ground you have not been
    // to, which is half the map and should read as ground (Part 10, rule 2).
    default:
      return <circle r={0.85} className="fill-surface stroke-ink-ghost" strokeWidth={0.35} />;
  }
}
