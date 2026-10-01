import { cn } from '@/lib/cn';
import { GROUND } from './module-mark';

/**
 * Dash's own mark, in four states: idle, working, done and failed.
 *
 * It is drawn from the parts the module marks were first built from: four
 * rounded squares in a two-by-two grid on the superellipse ground, one of them
 * the coloured node. Everything is in currentColor, so the mark takes the
 * accent (or the danger colour, or ink) of wherever it is placed.
 *
 * Each state has its own shape, so a still frame says which one it is and the
 * mark still reads under reduced motion, when nothing moves at all:
 *
 *   idle     three faint squares and the solid node, top right.
 *   working  the three squares shrink to dots and the node moves round them.
 *            Indeterminate: it circles at one pace and never fills, because a
 *            run does not yet report how far it has got.
 *   done     all four squares solid, with one flash as it settles.
 *   failed   all four squares hollow, and nothing moves.
 *
 * The motion is two utilities in app/globals.css, dash-mark-orbit and
 * dash-mark-flash, and both are switched off in the reduced-motion block.
 */

export type DashState = 'idle' | 'working' | 'done' | 'failed';

export const DASH_STATES: readonly DashState[] = ['idle', 'working', 'done', 'failed'];

/** What a screen reader hears for each state when no label is passed. */
export const DASH_STATE_LABELS: Record<DashState, string> = {
  idle: 'Dash',
  working: 'Dash is working',
  done: 'Dash has finished',
  failed: 'Dash could not finish',
};

/**
 * The first two match the Lucide icons the mark replaces (size-3.5 and
 * size-4); the other four are ModuleMark's sizes, so the mark can stand beside
 * a module mark at the same size.
 */
const SIZES = {
  '2xs': { box: 'size-3.5', px: 14 },
  icon: { box: 'size-4', px: 16 },
  xs: { box: 'size-[18px]', px: 18 },
  sm: { box: 'size-6', px: 24 },
  md: { box: 'size-8', px: 32 },
  lg: { box: 'size-11', px: 44 },
} as const;

export type DashMarkSize = keyof typeof SIZES;

/** The grid: top-left corner of each square, in reading order. */
const CELLS = [
  { x: 5, y: 5 },
  { x: 13, y: 5 },
  { x: 5, y: 13 },
  { x: 13, y: 13 },
] as const;
/** The node's home: the top-right square, where the module marks kept their key. */
const NODE = 1;
const CELL = 6;
const RADIUS = 1.8;
/** Hollow squares keep their outer edge where the solid ones are. */
const STROKE = 1.6;
/** A working cell shrinks to this, about its own centre. */
const DOT = 2.4;
const FAINT = 0.32;

function Square({
  x,
  y,
  hollow,
  opacity,
}: {
  x: number;
  y: number;
  hollow?: boolean;
  opacity?: number;
}) {
  if (hollow) {
    const inset = STROKE / 2;
    return (
      <rect
        x={x + inset}
        y={y + inset}
        width={CELL - STROKE}
        height={CELL - STROKE}
        rx={RADIUS - inset}
        fill="none"
        stroke="currentColor"
        strokeWidth={STROKE}
        strokeOpacity={opacity}
      />
    );
  }
  return (
    <rect
      x={x}
      y={y}
      width={CELL}
      height={CELL}
      rx={RADIUS}
      fill="currentColor"
      fillOpacity={opacity}
    />
  );
}

function Glyph({ state }: { state: DashState }) {
  const node = CELLS[NODE];
  const others = CELLS.filter((_, index) => index !== NODE);

  switch (state) {
    case 'working': {
      const offset = (CELL - DOT) / 2;
      return (
        <>
          {others.map((cell) => (
            <rect
              key={`${cell.x}-${cell.y}`}
              x={cell.x + offset}
              y={cell.y + offset}
              width={DOT}
              height={DOT}
              rx={DOT / 2}
              fill="currentColor"
              fillOpacity={FAINT}
            />
          ))}
          <g className="dash-mark-orbit">
            <Square x={node.x} y={node.y} />
          </g>
        </>
      );
    }

    case 'done':
      return (
        <g className="dash-mark-flash">
          {CELLS.map((cell) => (
            <Square key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} />
          ))}
        </g>
      );

    case 'failed':
      return (
        <>
          {CELLS.map((cell, index) => (
            <Square
              key={`${cell.x}-${cell.y}`}
              x={cell.x}
              y={cell.y}
              hollow
              opacity={index === NODE ? undefined : 0.6}
            />
          ))}
        </>
      );

    case 'idle':
    default:
      return (
        <>
          {others.map((cell) => (
            <Square key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} opacity={FAINT} />
          ))}
          <Square x={node.x} y={node.y} />
        </>
      );
  }
}

export function DashMark({
  state = 'idle',
  size = 'icon',
  label,
  decorative = false,
  className,
}: {
  state?: DashState;
  size?: DashMarkSize;
  /** Overrides the state's own accessible name. */
  label?: string;
  /**
   * Hidden from screen readers. For a mark beside text that already says Dash
   * and what it is doing, where the name would be read twice.
   */
  decorative?: boolean;
  className?: string;
}) {
  const sizing = SIZES[size];
  const name = label ?? DASH_STATE_LABELS[state];

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', sizing.box, className)}
      data-dash-state={state}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
    >
      <svg width={sizing.px} height={sizing.px} viewBox="0 0 24 24" fill="none" aria-hidden>
        <path d={GROUND} fill="currentColor" fillOpacity={0.12} />
        <Glyph state={state} />
      </svg>
    </span>
  );
}

/**
 * The idle mark at the start of a line that already says Dash wrote or made
 * something, such as "Written by Dash" or "Proposed by Dash" (plan #1338).
 * It sits in the run of text rather than in a flex row, so the words after it
 * wrap as ordinary text, and the line's own words carry the name.
 */
export function DashCredit({ className }: { className?: string }) {
  return <DashMark size="2xs" decorative className={cn('mr-1 align-[-0.2em]', className)} />;
}
