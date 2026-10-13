import { cn } from '@/lib/cn';
import { SKY, starColour } from '@/lib/learn/map/sky';

/**
 * A star as the legend and the rail show it (plan #1997.6): a small patch of
 * the night sky with one star on it, as bright as the strength it stands for.
 * The patch is dark in both themes, as the map is, so a star here looks like
 * the star on the map.
 */
export function StarSwatch({
  strength,
  slot = 'none',
  haze = 0,
  mixedUp = false,
  dust = false,
  className,
}: {
  strength: number;
  slot?: number | 'other' | 'none';
  haze?: number;
  mixedUp?: boolean;
  /** A vault note's speck instead of a star. */
  dust?: boolean;
  className?: string;
}) {
  const s = Math.min(Math.max(strength, 0), 1);
  return (
    <svg viewBox="-6 -6 12 12" className={cn('size-3.5 shrink-0', className)} aria-hidden>
      <circle r={6} style={{ fill: SKY.groundInner }} />
      {dust ? (
        <rect x={-1.2} y={-1.2} width={2.4} height={2.4} style={{ fill: SKY.dustSwatch }} />
      ) : s > 0 ? (
        <>
          <circle r={2 + 3 * s} style={{ fill: starColour(slot), opacity: 0.18 + 0.4 * s }} />
          <circle r={1 + 1.2 * Math.sqrt(s)} style={{ fill: starColour(slot), opacity: 0.7 + 0.3 * s }} />
        </>
      ) : (
        <>
          {haze > 0 && <circle r={4.5} style={{ fill: `rgb(${SKY.haze.join(',')})`, opacity: 0.35 }} />}
          <circle r={2.6} fill="none" strokeWidth={1} style={{ stroke: SKY.unlit }} />
        </>
      )}
      {mixedUp && <circle r={3.6} fill="none" strokeWidth={1} style={{ stroke: SKY.mixedUp }} />}
    </svg>
  );
}
