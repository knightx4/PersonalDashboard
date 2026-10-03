import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { MOTION_MS } from '@/lib/motion';

/**
 * The quiet-day sigil.
 *
 * A small mark drawn from a hash of a seed -- the account and the date -- so
 * it is different every day and yours: the same day gives the same mark
 * forever, which makes it a fact about the day rather than a random flourish.
 * It appears in exactly one situation: a page that is empty because you are
 * finished, not because you have nothing yet.
 *
 * It is built from the app's own geometry -- a grid of the rounded squares the
 * module mark is made of -- mirrored left to right, because a symmetrical
 * scatter reads as a glyph and an asymmetrical one reads as noise. Between
 * eight and fourteen cells are lit, which is dense enough to be a shape and
 * sparse enough to stay a constellation. One cell, the key, is a step
 * brighter than the rest, the way the module mark has one coloured node.
 *
 * Drawn in `currentColor`, so it takes the workspace accent from wherever it
 * is placed, and costs one inline SVG.
 *
 * Each cell carries `data-sigil-cell` and its place in reading order as
 * `--sigil-cell`, so an ancestor with `sigil-draw-in` (app/globals.css) can
 * draw the mark in cell by cell when a queue is cleared on screen
 * (QueueCleared in components/motion/clear.tsx). Without that class the
 * cells are simply there.
 */

/** FNV-1a, 32-bit. Small, stable, and good enough to scatter cells. */
function hash(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const GRID = 5;
const CELL = 8;
const NODE = 6.2;
const BOX = GRID * CELL;

/** The gap between one cell starting to draw in and the next, as in app/globals.css: half an instant. */
export const SIGIL_CELL_STAGGER_MS = MOTION_MS.instant / 2;
/**
 * The last place in the stagger. A sigil has fourteen cells at most when its
 * seed draws well; one that ran out of attempts can have more, and those land
 * with the fourteenth, so the draw is never longer than sigilDrawMs(14).
 */
const SIGIL_LAST_STAGGER = 13;
/** How long one cell takes to draw in, as in app/globals.css: one move. */
export const SIGIL_CELL_MS = MOTION_MS.move;

/**
 * How long drawing in a sigil of `cells` cells takes, from the first cell
 * starting to the last one landing. Fourteen cells, the most a sigil has,
 * take 845ms.
 */
export function sigilDrawMs(cells: number): number {
  if (cells <= 0) return 0;
  return Math.min(cells - 1, SIGIL_LAST_STAGGER) * SIGIL_CELL_STAGGER_MS + SIGIL_CELL_MS;
}

export function sigilCells(seed: string): { x: number; y: number; key: boolean }[] {
  let h = hash(seed);
  const next = () => {
    // xorshift32 over the hash, so one seed yields as many bits as needed.
    h ^= h << 13;
    h >>>= 0;
    h ^= h >>> 17;
    h ^= h << 5;
    h >>>= 0;
    return h;
  };

  // Decide the left three columns; the right two mirror the left two.
  const on: boolean[][] = Array.from({ length: GRID }, () => Array(GRID).fill(false));
  let lit = 0;
  for (let attempt = 0; attempt < 6 && (lit < 8 || lit > 14); attempt += 1) {
    lit = 0;
    for (let y = 0; y < GRID; y += 1) {
      for (let x = 0; x < 3; x += 1) {
        const bit = (next() & 0xff) < 110;
        on[y][x] = bit;
        on[y][GRID - 1 - x] = bit;
      }
    }
    for (let y = 0; y < GRID; y += 1) for (let x = 0; x < GRID; x += 1) if (on[y][x]) lit += 1;
  }

  const cells: { x: number; y: number; key: boolean }[] = [];
  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      if (on[y][x]) cells.push({ x, y, key: false });
    }
  }
  if (cells.length > 0) {
    const keyIndex = next() % cells.length;
    cells[keyIndex] = { ...cells[keyIndex], key: true };
  }
  return cells;
}

export function Sigil({
  seed,
  size = 56,
  className,
}: {
  seed: string;
  size?: number;
  className?: string;
}) {
  const cells = sigilCells(seed);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${BOX} ${BOX}`}
      className={cn('shrink-0', className)}
      aria-hidden
      focusable="false"
    >
      {cells.map((cell, index) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          data-sigil-cell=""
          style={{ '--sigil-cell': String(Math.min(index, SIGIL_LAST_STAGGER)) } as CSSProperties}
          x={cell.x * CELL + (CELL - NODE) / 2}
          y={cell.y * CELL + (CELL - NODE) / 2}
          width={NODE}
          height={NODE}
          rx={1.6}
          fill="currentColor"
          opacity={cell.key ? 1 : 0.42}
        />
      ))}
    </svg>
  );
}
