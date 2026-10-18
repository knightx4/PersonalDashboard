import type { ReactNode } from 'react';
import { z } from 'zod';
import { cn } from '@/lib/cn';

/**
 * What the diagram kinds share (plan #2321.2): flow, cycle, tree, two_by_two
 * and timeline. The writer gives labels and how they connect; these helpers
 * lay them out in inline SVG, so no spec carries a coordinate.
 *
 * Each SVG's viewBox is about as wide as it is drawn, so its 13-unit text
 * reads at about 13 pixels: the phone layouts are drawn 320 wide, the wide
 * ones 600 and the large ones 900, and an SVG never grows past its viewBox. Colours are the
 * theme's tokens as fill and stroke classes, so both themes draw from the
 * same markup. Nothing moves, so reduced motion has nothing to stop.
 */

export const PHONE_WIDTH = 320;
export const WIDE_WIDTH = 600;
export const LARGE_WIDTH = 900;

export const FONT = 13;
export const LINE = 16;
/** Average width of one character at `FONT`, for wrapping before drawing. */
const CHAR = 6.9;
const BOX_PAD_X = 8;
const BOX_PAD_Y = 8;

/**
 * A label the writer gives: trimmed to one line of words. One past `max`
 * characters is cut at a word with an ellipsis rather than refused, since a
 * figure is worth more than a label's last words.
 */
export function label(max: number) {
  return z
    .string()
    .transform((text) => shorten(text.replace(/\s+/g, ' ').trim(), max))
    .pipe(z.string().min(1));
}

/** `text` in at most `max` characters, cut at the last whole word with an ellipsis. */
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, '')}…`;
}

/** How many characters fit on one line `width` units wide. */
export function charsIn(width: number): number {
  return Math.max(4, Math.floor(width / CHAR));
}

/**
 * Words wrapped to lines of at most `perLine` characters, at most `maxLines`
 * of them; a word longer than a line is broken, and what does not fit ends
 * the last line with an ellipsis.
 */
export function wrap(text: string, perLine: number, maxLines = 3): string[] {
  const lines: string[] = [];
  let line = '';
  for (let word of text.split(' ')) {
    while (word.length > perLine) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(word.slice(0, perLine - 1) + '-');
      word = word.slice(perLine - 1);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= perLine) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = `${last.slice(0, Math.max(1, perLine - 1)).trimEnd()}…`;
  return kept;
}

export type Box = { x: number; y: number; w: number; h: number; lines: string[] };

/** A box `w` wide holding `text`, its height from the lines it wraps to. */
export function box(text: string, w: number, maxLines = 3): Omit<Box, 'x' | 'y'> {
  const lines = wrap(text, charsIn(w - 2 * BOX_PAD_X), maxLines);
  return { w, h: lines.length * LINE + 2 * BOX_PAD_Y, lines };
}

/** A box no wider than its label needs, up to `maxW`, the label on as few lines as that allows. */
export function fitBox(text: string, maxW: number, maxLines = 3): Omit<Box, 'x' | 'y'> {
  const natural = text.length * CHAR + 2 * BOX_PAD_X + 4;
  return box(text, Math.min(maxW, Math.max(64, natural)), maxLines);
}

/** The point where the line from the box's centre toward (tx, ty) leaves the box. */
export function edgeOf(b: Box, tx: number, ty: number): [number, number] {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const scale = Math.min(dx === 0 ? Infinity : b.w / 2 / Math.abs(dx), dy === 0 ? Infinity : b.h / 2 / Math.abs(dy));
  return [cx + dx * scale, cy + dy * scale];
}

/** The SVG every diagram draws in: as wide as its viewBox at most, read as one image. */
export function DiagramSvg({
  width,
  height,
  title,
  className,
  children,
}: {
  width: number;
  height: number;
  /** What a screen reader says for the whole diagram. */
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox={`0 0 ${Math.ceil(width)} ${Math.ceil(height)}`}
      width="100%"
      role="img"
      aria-label={title}
      className={cn('block h-auto max-w-full', className)}
      style={{ maxWidth: Math.ceil(width) }}
      fontSize={FONT}
    >
      {children}
    </svg>
  );
}

/** Lines of text centred on (x, y), or starting at x when `align` is start. */
export function Lines({
  lines,
  x,
  y,
  align = 'middle',
  className = 'fill-ink',
}: {
  lines: readonly string[];
  x: number;
  /** The middle of the block of lines. */
  y: number;
  align?: 'start' | 'middle' | 'end';
  className?: string;
}) {
  const top = y - (lines.length * LINE) / 2;
  return (
    <text x={x} textAnchor={align} className={className}>
      {lines.map((line, index) => (
        <tspan key={index} x={x} y={top + index * LINE + LINE / 2} dominantBaseline="central">
          {line}
        </tspan>
      ))}
    </text>
  );
}

/** A labelled box. */
export function Node({ b, align = 'middle', strong = false }: { b: Box; align?: 'start' | 'middle'; strong?: boolean }) {
  return (
    <g>
      <rect
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        rx={6}
        className={strong ? 'fill-accent-tint stroke-accent' : 'fill-surface stroke-border-strong'}
        strokeWidth={1}
      />
      <Lines
        lines={b.lines}
        x={align === 'start' ? b.x + BOX_PAD_X : b.x + b.w / 2}
        y={b.y + b.h / 2}
        align={align}
        className={strong ? 'fill-ink font-semibold' : 'fill-ink'}
      />
    </g>
  );
}

/** An arrowhead at (x, y) pointing along `angle` radians. */
export function Head({ x, y, angle }: { x: number; y: number; angle: number }) {
  const size = 7;
  const spread = 0.45;
  const a = [x - size * Math.cos(angle - spread), y - size * Math.sin(angle - spread)];
  const b = [x - size * Math.cos(angle + spread), y - size * Math.sin(angle + spread)];
  return <polygon points={`${x},${y} ${a[0]},${a[1]} ${b[0]},${b[1]}`} className="fill-ink-muted" />;
}

/** A straight arrow from one point to another, stopping short of the target by `gap`. */
export function Arrow({ from, to, gap = 3 }: { from: [number, number]; to: [number, number]; gap?: number }) {
  const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
  const end: [number, number] = [to[0] - gap * Math.cos(angle), to[1] - gap * Math.sin(angle)];
  return (
    <g>
      <line x1={from[0]} y1={from[1]} x2={end[0]} y2={end[1]} className="stroke-ink-muted" strokeWidth={1.25} />
      <Head x={end[0]} y={end[1]} angle={angle} />
    </g>
  );
}

/**
 * Draws the phone layout below `sm`, the wide one from it, and the large one
 * from `lg`, where the lesson's column is wide enough for a diagram to span
 * it at the same text size.
 */
export function PhoneAndWide({ phone, wide, large }: { phone: ReactNode; wide: ReactNode; large?: ReactNode }) {
  return (
    <>
      <div className="sm:hidden">{phone}</div>
      <div className={large ? 'max-sm:hidden lg:hidden' : 'max-sm:hidden'}>{wide}</div>
      {large ? <div className="max-lg:hidden">{large}</div> : null}
    </>
  );
}
