'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/cn';
import {
  anchorAt,
  hueFill,
  mapHref,
  type AreaLabel,
  type MapColour,
  type MapParams,
  type StateMark,
} from '@/lib/learn/map/view';

/**
 * The Idea Space map itself (plan #1857): every embedded idea as a mark, in
 * SVG, with the field and domain names laid over it in HTML.
 *
 * The SVG stretches to the frame, so the marks are drawn at one unit and
 * scaled per width by class: a dot is about eight pixels across on a phone
 * and on a laptop alike, where scaling with the frame would make it three
 * times larger on the wider one. Names are HTML on top for the same reason,
 * since text inside a stretched SVG would shrink to nothing on a phone.
 *
 * A dot is a few pixels across, too small to press, so the map is pressed as
 * a whole and the press picks the nearest idea within a finger's reach. The
 * pick shows at once on the map, and the address carries it (law 5), which
 * is what brings the idea's details into the rail. With a mouse, pointing
 * names the idea under the pointer.
 */

export type PlotDot = {
  id: string;
  name: string;
  left: number;
  top: number;
  mark: StateMark;
  /** The domain's colour slot, `other` for a domain without one, `none` for no domain. */
  slot: number | 'other' | 'none';
  neighbours: string[];
};

export type PlotArea = AreaLabel & {
  /** Ideas on the map under it. A field with none is ground not visited yet. */
  visited: boolean;
  fitsPhone: boolean;
  fitsWide: boolean;
};

/** A finger's reach, in CSS pixels: half the 44px press target. */
const REACH_PX = 22;

/** One unit of the 0–100 frame is drawn at this scale per width. */
const MARK_SCALE =
  '[transform-box:fill-box] origin-center scale-[1.1] sm:scale-[0.7] lg:scale-[0.55]';

export function IdeaPlot({
  dots,
  areas,
  params,
}: {
  dots: readonly PlotDot[];
  /** Null when the names are off. */
  areas: readonly PlotArea[] | null;
  params: MapParams;
}) {
  const router = useRouter();
  // What the press picked, shown before the page comes back with the rail.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [pointing, setPointing] = useState<string | null>(null);
  const selectedId = picked === undefined ? params.idea : picked;

  const byId = new Map(dots.map((dot) => [dot.id, dot]));
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null;
  const near = new Set(selected?.neighbours ?? []);

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

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const dot = nearest(event);
    if (!dot && !selectedId) return;
    const id = dot ? dot.id : null;
    setPicked(id);
    router.push(mapHref(params, { idea: id }), { scroll: false });
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
    <div
      className={cn(
        'relative aspect-square w-full overflow-hidden',
        dots.length > 0 && 'cursor-pointer',
      )}
      onPointerUp={pick}
      onPointerMove={point}
      onPointerLeave={() => setPointing(null)}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 size-full"
        role="img"
        aria-label={`A map of ${dots.length} ideas, each placed near the ideas most like it`}
      >
        {areas?.map((area) =>
          area.kind === 'field' ? (
            <g key={area.id} transform={`translate(${area.left} ${area.top})`}>
              <title>{area.text}</title>
              <path
                d="M-1 0H1M0 -1V1"
                className={cn(
                  MARK_SCALE,
                  area.visited ? 'stroke-ink-muted' : 'stroke-ink-ghost',
                  // The cross stands in for a name with no room; where the
                  // name is drawn it marks the spot already.
                  area.fitsPhone && 'max-sm:hidden',
                  area.fitsWide && 'sm:hidden',
                )}
                strokeWidth={0.35}
                fill="none"
              />
            </g>
          ) : null,
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
          <g key={dot.id} transform={`translate(${dot.left} ${dot.top})`}>
            <g className={MARK_SCALE}>
              <Mark dot={dot} colour={params.colour} />
              {near.has(dot.id) && (
                <circle r={1.6} fill="none" className="stroke-accent" strokeWidth={0.35} />
              )}
            </g>
          </g>
        ))}

        {selected && (
          <g transform={`translate(${selected.left} ${selected.top})`}>
            <g className={MARK_SCALE}>
              <Mark dot={selected} colour={params.colour} />
              <circle r={2} fill="none" className="stroke-accent" strokeWidth={0.55} />
            </g>
          </g>
        )}
      </svg>

      {areas?.map((area) => (
        <MapName
          key={area.id}
          left={area.left}
          top={area.top}
          className={cn(
            !area.fitsPhone && 'max-sm:hidden',
            !area.fitsWide && 'sm:hidden',
            area.kind === 'domain'
              ? 'text-ui font-semibold text-ink'
              : cn('text-small text-ink-muted', !area.visited && 'italic'),
          )}
        >
          {area.text}
        </MapName>
      ))}

      {selected && (
        <MapName
          left={selected.left}
          top={selected.top}
          above
          className="bg-raised text-ui font-medium text-ink ring-1 ring-border"
        >
          {selected.name}
        </MapName>
      )}
      {shown && (
        <MapName
          left={shown.left}
          top={shown.top}
          above
          className="bg-raised text-ui text-ink ring-1 ring-border"
        >
          {shown.name}
        </MapName>
      )}
    </div>
  );
}

/** A name laid over the map at a point, hanging inwards from the frame's edges. */
function MapName({
  left,
  top,
  above = false,
  className,
  children,
}: {
  left: number;
  top: number;
  /** Over the point rather than on it, for an idea's own name. */
  above?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const anchor = anchorAt(left);
  const x = anchor === 'start' ? '0' : anchor === 'end' ? '-100%' : '-50%';
  const y = above ? 'calc(-100% - 0.75rem)' : '-50%';
  return (
    <span
      className={cn(
        'pointer-events-none absolute max-w-xs truncate rounded-control px-1 whitespace-nowrap',
        // A halo of the card's own ground rather than a box, so a name
        // stays readable over the dots without hiding them.
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
    case 'known':
      return <circle r={1} className="fill-ink" />;
    case 'getting-there':
      return <circle r={0.8} className="fill-surface stroke-ink" strokeWidth={0.4} />;
    case 'mixed-up':
      return <path d="M0 -1.3L1.3 0L0 1.3L-1.3 0Z" className="fill-danger" />;
    default:
      return <circle r={0.6} className="fill-ink-ghost" />;
  }
}
