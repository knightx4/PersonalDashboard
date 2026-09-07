import { useId } from 'react';
import { cn } from '@/lib/cn';
import { HOME_MARK, moduleById, type MarkKey, type MarkShape, type ModuleId } from '@/lib/modules';

/**
 * One mark, any number of faces.
 *
 * Four nodes filling a square. Three of them never change and carry no
 * colour; the fourth -- top right -- is the module: a small picture of what it
 * is, in its own hue, and the only colour anywhere in the mark.
 *
 * That split is the point. The constant three say "this is the same app"
 * without needing to be looked at, and the key says which room you are in
 * without needing to be read. The version before this encoded the module in
 * *which* node was promoted, which was legible but ran out at four modules; a
 * picture plus a hue does not, and it is recognisable before anyone has
 * learned the colour.
 *
 * The tile is a fixed near-black rather than the module's colour. A coloured
 * tile with a coloured key is two things competing to be the signal, and the
 * gradient-filled rounded square it used to be is the most dated shape in
 * software.
 *
 * Geometry is in a 24 unit box so the same paths serve 20px and 44px.
 */

/**
 * The three that never move, and the corner the key sits in.
 *
 * Pushed out near the edges: the constellation is the mark, not a motif
 * floating in a tile, and the earlier version left so much padding that the
 * tile read as the logo and the squares as an afterthought.
 */
const CONSTANT_CELLS = [
  [7.1, 7.1],
  [7.1, 16.9],
  [16.9, 16.9],
] as const;
const KEY_CELL = [16.9, 7.1] as const;

const NODE = 8.2;

const SIZES = {
  sm: { box: 'size-6 rounded-[7px]', svg: 17 },
  md: { box: 'size-8 rounded-[9px]', svg: 22 },
  lg: { box: 'size-11 rounded-[13px]', svg: 30 },
} as const;

/** Near-black, fixed. The mark is an object; it does not follow the theme. */
const TILE = '#101216';

/**
 * The key, drawn about its own centre.
 *
 * Every one of these is a single filled silhouette. No strokes, no counters,
 * and no gap narrower than roughly a sixth of the shape -- at twenty-four
 * pixels the key is about five, and anything finer than that closes up into a
 * blob. It is also why the bag has two ears rather than a drawn handle: the
 * gap between them survives being small, a 1px arc does not.
 *
 * Each runs a little larger than a constant node and overruns its cell, so it
 * reads as the thing the other three are pointing at rather than as a fourth
 * one of them.
 */
function KeyShape({ shape, fill }: { shape: MarkShape; fill: string }) {
  const [cx, cy] = KEY_CELL;

  switch (shape) {
    case 'bag':
      return (
        <g fill={fill}>
          {/* A real arch with a real hole. Below about 32px the hole closes and
              this becomes a coloured blob -- which is the honest trade, because
              at that size no bag is legible and the hue is doing the work. */}
          <path
            d={`M${cx - 3.2} ${cy - 1.3}A3.2 3.2 0 0 1 ${cx + 3.2} ${cy - 1.3}H${cx + 1.5}A1.5 1.5 0 0 0 ${cx - 1.5} ${cy - 1.3}Z`}
          />
          <rect x={cx - 4.9} y={cy - 1.6} width={9.8} height={6.7} rx={1.6} />
        </g>
      );
    case 'briefcase':
      return (
        <g fill={fill}>
          {/* One centred tab, against the bag's two -- convex top, not concave. */}
          <rect x={cx - 2.1} y={cy - 4.9} width={4.2} height={2.8} rx={0.9} />
          <rect x={cx - 4.9} y={cy - 2.6} width={9.8} height={7.4} rx={1.5} />
        </g>
      );
    case 'check':
      return (
        <path
          fill={fill}
          d={`M${cx - 4.6} ${cy + 0.4}L${cx - 2.7} ${cy - 1.6}L${cx - 1.1} ${cy + 0.1}L${cx + 3.1} ${cy - 4.4}L${cx + 4.9} ${cy - 2.6}L${cx - 1.1} ${cy + 4.1}Z`}
        />
      );
    case 'page':
      return (
        <path
          fill={fill}
          d={`M${cx - 3.9} ${cy - 4.9}H${cx + 0.3}L${cx + 4.1} ${cy - 1.1}V${cy + 4.9}H${cx - 3.9}Z`}
        />
      );
    case 'bolt':
      // The workshop: a solid bolt, no notch narrow enough to close up. It
      // reads as "the thing that makes the rest of it work" rather than as a
      // place you keep something, which is what the other four are.
      return (
        <path
          fill={fill}
          d={`M${cx + 1.5} ${cy - 5}L${cx - 4.5} ${cy + 0.9}H${cx - 0.6}L${cx - 1.5} ${cy + 5}L${cx + 4.5} ${cy - 0.9}H${cx + 0.6}Z`}
        />
      );
    case 'orb':
    default:
      return <circle cx={cx} cy={cy} r={5.1} fill={fill} />;
  }
}

export function ModuleMark({
  module,
  size = 'md',
  className,
}: {
  /** null means the app itself. */
  module: ModuleId | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const entry = moduleById(module) ?? HOME_MARK;
  const key = entry.key as MarkKey;
  const sizing = SIZES[size];
  const gradientId = useId();

  return (
    <span
      className={cn('relative flex shrink-0 items-center justify-center', sizing.box, className)}
      style={{
        background: TILE,
        // A near-black tile on a near-black surface needs an edge, or the mark
        // dissolves into the sidebar in three of the five themes.
        boxShadow:
          'inset 0 0 0 1px rgb(255 255 255 / 0.09), inset 0 1px 0 rgb(255 255 255 / 0.13)',
      }}
      aria-hidden
    >
      <svg width={sizing.svg} height={sizing.svg} viewBox="0 0 24 24" fill="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={key.from} />
            <stop offset="100%" stopColor={key.to} />
          </linearGradient>
        </defs>

        {CONSTANT_CELLS.map(([cx, cy]) => (
          <rect
            key={`${cx}-${cy}`}
            x={cx - NODE / 2}
            y={cy - NODE / 2}
            width={NODE}
            height={NODE}
            rx={NODE * 0.32}
            fill="#ffffff"
            // Dimmed, so the key leads. At full white the three constants
            // shout as loudly as the one thing that carries meaning.
            opacity={0.68}
          />
        ))}

        <KeyShape shape={key.shape} fill={`url(#${gradientId})`} />
      </svg>
    </span>
  );
}
