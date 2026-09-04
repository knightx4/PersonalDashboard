import { cn } from '@/lib/cn';
import { HOME_MARK, MODULES, moduleById, type ModuleId } from '@/lib/modules';

/**
 * One mark, five faces.
 *
 * The problem this solves: the marks have to read as one family -- these are
 * four rooms in one house -- while each still stands on its own, and the
 * app's own mark has to be a real thing rather than a fifth sibling.
 *
 * So: every mark is the same constellation. Four nodes in a square, laid out
 * in the order the modules are listed -- shopping, job search, todo, vault,
 * reading left to right and top to bottom. The home mark shows all four,
 * evenly. A module's mark promotes its own node and lets the other three
 * recede, and the tile takes that module's hue.
 *
 * The result is that the home mark literally contains the four modules, and a
 * module mark is visibly a view of the same object. A glyph per module -- a
 * bag, a briefcase -- said nothing about the other three and made five
 * unrelated pictures.
 *
 * Geometry is in a 24 unit box so the same paths serve 20px and 44px.
 */

/** Node centres, in the order MODULES are declared. */
const CELLS: Record<ModuleId, readonly [number, number]> = {
  shopping: [8.6, 8.6],
  jobs: [15.4, 8.6],
  todo: [8.6, 15.4],
  vault: [15.4, 15.4],
};

const SIZES = {
  sm: { box: 'size-6 rounded-[7px]', svg: 14 },
  md: { box: 'size-8 rounded-[9px]', svg: 19 },
  lg: { box: 'size-11 rounded-[13px]', svg: 26 },
} as const;

function Node({
  cx,
  cy,
  side,
  opacity,
}: {
  cx: number;
  cy: number;
  side: number;
  opacity: number;
}) {
  return (
    <rect
      x={cx - side / 2}
      y={cy - side / 2}
      width={side}
      height={side}
      rx={side * 0.34}
      fill="currentColor"
      opacity={opacity}
    />
  );
}

export function ModuleMark({
  module,
  size = 'md',
  className,
}: {
  /** null means the app itself -- all four nodes, evenly. */
  module: ModuleId | null;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const entry = moduleById(module) ?? HOME_MARK;
  const sizing = SIZES[size];
  const [from, to] = entry.mark;

  return (
    <span
      className={cn('relative flex shrink-0 items-center justify-center', sizing.box, className)}
      style={{
        backgroundImage: `linear-gradient(145deg, ${from} 0%, ${to} 100%)`,
        boxShadow: 'inset 0 1px 0 rgb(255 255 255 / 0.25), 0 1px 2px rgb(0 0 0 / 0.2)',
      }}
      aria-hidden
    >
      <svg
        width={sizing.svg}
        height={sizing.svg}
        viewBox="0 0 24 24"
        className="text-white"
        fill="none"
      >
        {MODULES.map((candidate) => {
          const [cx, cy] = CELLS[candidate.id];
          if (module === null) {
            // Home: four equal nodes. The whole account, nothing promoted.
            return <Node key={candidate.id} cx={cx} cy={cy} side={6.2} opacity={0.95} />;
          }
          const mine = candidate.id === module;
          return (
            <Node
              key={candidate.id}
              cx={cx}
              cy={cy}
              // The recessive nodes have to survive 24px, where 0.42 opacity
              // on four units disappears entirely and the mark stops being a
              // member of the family.
              side={mine ? 7.8 : 4.4}
              opacity={mine ? 1 : 0.55}
            />
          );
        })}
      </svg>
    </span>
  );
}
