'use client';

import { House } from 'lucide-react';
import Link from '@/components/ui/link';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { placeHref } from '@/lib/you/places';
import { positionAt, type PlacesMapDrawing } from '@/lib/you/places-map';

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
  className,
}: {
  drawing: PlacesMapDrawing;
  onPressPosition?: (position: { latitude: number; longitude: number }) => void;
  /** A place whose tooltip starts showing. For the gallery's shot of a hovered dot. */
  tipOpenFor?: string;
  className?: string;
}) {
  const { width, height } = drawing;

  function press(event: React.MouseEvent<SVGSVGElement>) {
    if (!onPressPosition) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * width;
    const y = ((event.clientY - box.top) / box.height) * height;
    const position = positionAt(drawing.frame, x, y);
    if (position) onPressPosition(position);
  }

  return (
    <div className={cn('relative w-full', className)} style={{ aspectRatio: `${width} / ${height}` }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={cn('absolute inset-0 size-full rounded-card', onPressPosition && 'cursor-crosshair')}
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
            <li
              key={dot.id}
              className="absolute"
              style={{
                left: `${(dot.x / width) * 100}%`,
                top: `${(dot.y / height) * 100}%`,
                translate: '-50% -50%',
              }}
            >
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
                  {dot.current ? (
                    <span className="grid size-6 place-items-center rounded-pill bg-accent text-fill-ink ring-2 ring-surface">
                      <House className="size-3.5" strokeWidth={1.75} aria-hidden />
                    </span>
                  ) : (
                    <span className="size-3 rounded-pill bg-accent ring-2 ring-surface" />
                  )}
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
            </li>
          ))}
      </ul>
    </div>
  );
}
