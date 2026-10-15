'use client';

import { House } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import Link from '@/components/ui/link';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { placeHref } from '@/lib/you/places';
import { positionAt, type MapDot, type PlacesMapDrawing } from '@/lib/you/places-map';

/**
 * The map of the places they have lived (plan #2091.4): the land and its
 * borders drawn from the bundled outlines, the line through the homes in
 * the order they moved in, and a dot per home. Pressing a dot opens the
 * place; hovering one names it and its years. The home they live in now is
 * the larger dot with the house in it, the same mark the list uses. Each
 * dot carries its name beside it.
 *
 * The outlines are an SVG scaled to the column. The dots are links laid over
 * it at the same proportions, so each keeps its tooltip, its focus ring and
 * a press area of a fixed size whatever the map's width.
 *
 * `onPressPosition` is for placing a place by hand (#2091.5): a press on the
 * map away from a dot is turned back into a latitude and longitude.
 */
export function PlacesMap({
  drawing,
  onPressPosition,
  tipOpenFor,
  linkDots = true,
  capped = false,
  className,
}: {
  drawing: PlacesMapDrawing;
  onPressPosition?: (position: { latitude: number; longitude: number }) => void;
  /** A place whose tooltip starts showing. For the gallery's shot of a hovered dot. */
  tipOpenFor?: string;
  /** False on a place's own page, where its dot has nowhere else to open. */
  linkDots?: boolean;
  /**
   * Stops growing taller past a phone's proportions (plan #2091.5): from sm
   * the map keeps a fixed height and widens, cropping the top and bottom of
   * the drawing round its middle, where the frame puts the dots.
   */
  capped?: boolean;
  className?: string;
}) {
  const { width, height } = drawing;
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const element = boxRef.current;
    if (!capped || !element) return;
    const observer = new ResizeObserver(([entry]) => {
      setBox({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [capped]);

  /** How the drawing sits in a box of this size, cropped to fill it as the SVG's `slice` does. */
  function fit(w: number, h: number) {
    const scale = Math.max(w / width, h / height);
    return { scale, left: (w - width * scale) / 2, top: (h - height * scale) / 2 };
  }

  function press(event: React.MouseEvent<SVGSVGElement>) {
    if (!onPressPosition) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const { scale, left, top } = fit(rect.width, rect.height);
    const x = (event.clientX - rect.left - left) / scale;
    const y = (event.clientY - rect.top - top) / scale;
    const position = positionAt(drawing.frame, x, y);
    if (position) onPressPosition(position);
  }

  /** Where a dot goes: a share of the box, or, cropped, pixels once the box is measured. */
  function dotStyle(dot: MapDot): React.CSSProperties {
    const base = { translate: '-50% -50%' } as const;
    if (!capped)
      return { ...base, left: `${(dot.x / width) * 100}%`, top: `${(dot.y / height) * 100}%` };
    if (!box) return { ...base, visibility: 'hidden' };
    const { scale, left, top } = fit(box.w, box.h);
    return { ...base, left: left + dot.x * scale, top: top + dot.y * scale };
  }

  return (
    <div
      ref={boxRef}
      className={cn(
        'relative w-full overflow-hidden',
        capped && 'aspect-[4/3] sm:aspect-auto sm:h-96',
        className,
      )}
      style={capped ? undefined : { aspectRatio: `${width} / ${height}` }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio={capped ? 'xMidYMid slice' : undefined}
        className={cn(
          'absolute inset-0 size-full rounded-card',
          onPressPosition && 'cursor-crosshair',
        )}
        aria-hidden
        onClick={onPressPosition ? press : undefined}
      >
        <path d={drawing.land} className="fill-sunken" />
        <path
          d={drawing.states}
          className="fill-none stroke-border"
          strokeWidth={0.75}
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={drawing.borders}
          className="fill-none stroke-border-strong"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        {drawing.route && (
          <path
            d={drawing.route}
            className="fill-none stroke-accent"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={0.55}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <ul aria-label="Places on the map">
        {/* The home they live in now goes last, so it is drawn over any line or dot near it. */}
        {[...drawing.dots]
          .sort((a, b) => Number(a.current) - Number(b.current))
          .map((dot) => (
            <li key={dot.id} className="absolute" style={dotStyle(dot)}>
              {linkDots ? (
                <PlaceDot dot={dot} width={width} height={height} tipOpenFor={tipOpenFor} />
              ) : (
                // On the place's own page: the mark alone, which a press
                // passes through, so the place can be moved by pressing
                // right beside where it is.
                <span
                  role="img"
                  aria-label={`${dot.name} is here`}
                  className="pointer-events-none grid size-6 place-items-center"
                >
                  <DotMark current={dot.current} />
                </span>
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}

function DotMark({ current }: { current: boolean }) {
  return current ? (
    <span className="grid size-6 place-items-center rounded-pill bg-accent text-fill-ink ring-2 ring-surface">
      <House className="size-3.5" strokeWidth={1.75} aria-hidden />
    </span>
  ) : (
    <span className="size-3 rounded-pill bg-accent ring-2 ring-surface" />
  );
}

/** A dot on the Places map: a link to the place, its tooltip, and its name beside it. */
function PlaceDot({
  dot,
  width,
  height,
  tipOpenFor,
}: {
  dot: MapDot;
  width: number;
  height: number;
  tipOpenFor?: string;
}) {
  return (
    <>
      <Tooltip
        label={dot.label}
        align={dot.x > width / 2 ? 'end' : 'start'}
        // Above a dot in the lower half, so the tip stays on the map
        // rather than hanging over the caption under it.
        above={dot.y > height / 2}
        defaultOpen={dot.id === tipOpenFor}
      >
        <Link
          href={placeHref(dot.id)}
          aria-label={dot.current ? `${dot.label}, where you live now` : dot.label}
          className="press-area grid size-6 place-items-center rounded-pill focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          <DotMark current={dot.current} />
        </Link>
      </Tooltip>
      {/* The name beside the dot, since a phone has no hover to read
                  the tooltip with. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 max-w-32 -translate-y-1/2 truncate rounded-control bg-surface/85 px-1 text-small whitespace-nowrap text-ink-muted sm:max-w-48',
          dot.labelSide === 'left' ? 'right-full mr-1' : 'left-full ml-1',
        )}
      >
        {dot.name}
      </span>
    </>
  );
}
