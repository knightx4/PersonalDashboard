import { useId } from 'react';
import { cn } from '@/lib/cn';
import { HOME_MARK, moduleById, type MarkKey, type MarkShape, type ModuleId } from '@/lib/modules';

/**
 * One mark, any number of faces.
 *
 * Four nodes in a square. Three of them never change and carry no colour; the
 * fourth -- top right -- is the module, and is the only colour and the only
 * non-square shape in the whole thing.
 *
 * That split is the point. The constant three say "this is the same app"
 * without needing to be looked at, and the key says which room you are in
 * without needing to be read. The version before this encoded the module in
 * *which* node was promoted, which was legible but ran out at four modules;
 * a shape plus a hue does not.
 *
 * The tile is a fixed near-black rather than the module's colour. A coloured
 * tile with a coloured key is two things competing to be the signal, and the
 * gradient-filled rounded square it used to be is the most dated shape in
 * software.
 *
 * Geometry is in a 24 unit box so the same paths serve 20px and 44px.
 */

/** The three that never move, and the corner the key sits in. */
const CONSTANT_CELLS = [
  [7.8, 7.8],
  [7.8, 16.2],
  [16.2, 16.2],
] as const;
const KEY_CELL = [16.0, 8.0] as const;

const NODE = 6.2;
/**
 * Half again the size of a node, and it overruns its cell.
 *
 * At a node's size the key read as a fourth dot that happened to be coloured,
 * which is the opposite of the point. Breaking the grid is what turns it from
 * a member of the set into the thing the set is pointing at.
 */
const KEY = 8.8;

const SIZES = {
  sm: { box: 'size-6 rounded-[7px]', svg: 15 },
  md: { box: 'size-8 rounded-[9px]', svg: 20 },
  lg: { box: 'size-11 rounded-[13px]', svg: 27 },
} as const;

/** Near-black, fixed. The mark is an object; it does not follow the theme. */
const TILE = '#101216';

function keyPath(shape: MarkShape): string {
  const [cx, cy] = KEY_CELL;
  const half = KEY / 2;

  switch (shape) {
    case 'diamond': {
      const reach = half * 1.12;
      return `M${cx} ${cy - reach}L${cx + reach} ${cy}L${cx} ${cy + reach}L${cx - reach} ${cy}Z`;
    }
    case 'triangle': {
      // Sat slightly low in its cell: an upward triangle reads as higher than
      // it is, and lining its centroid up with the nodes looks like a mistake.
      const r = half * 1.14;
      const top = cy - r + 0.5;
      const bottom = cy + r * 0.82 + 0.5;
      return `M${cx} ${top}L${cx + r * 1.02} ${bottom}L${cx - r * 1.02} ${bottom}Z`;
    }
    case 'quarter': {
      // A square with one corner taken all the way round.
      // A square with one corner taken all the way round -- half straight,
      // half curve, which is a silhouette nothing else here has.
      const x = cx - half;
      const y = cy - half;
      return `M${x} ${y}H${x + KEY}A${KEY} ${KEY} 0 0 1 ${x} ${y + KEY}Z`;
    }
    case 'pill': {
      const w = KEY * 0.98;
      const h = KEY * 0.52;
      const x = cx - w / 2;
      const y = cy - h / 2;
      return `M${x + h / 2} ${y}H${x + w - h / 2}A${h / 2} ${h / 2} 0 0 1 ${x + w - h / 2} ${y + h}H${x + h / 2}A${h / 2} ${h / 2} 0 0 1 ${x + h / 2} ${y}Z`;
    }
    case 'circle':
    default:
      return '';
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

        {key.shape === 'circle' ? (
          <circle cx={KEY_CELL[0]} cy={KEY_CELL[1]} r={KEY / 2} fill={`url(#${gradientId})`} />
        ) : (
          <path d={keyPath(key.shape)} fill={`url(#${gradientId})`} />
        )}
      </svg>
    </span>
  );
}
