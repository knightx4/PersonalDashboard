import { cn } from '@/lib/cn';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';

/**
 * The status glyphs, drawn.
 *
 * One hexagon, eleven ways. A ladder is the hexagon filled further round from
 * twelve o'clock as it advances — empty, a quarter, a half, three quarters,
 * solid — and everything that is not on a ladder is the same hexagon with a
 * mark struck through or set inside it. Which glyph a status gets is in
 * lib/status-glyphs.ts; this file knows about shapes and nothing else, so a
 * status renamed tomorrow does not touch it.
 *
 * A hexagon rather than a ring because the 2026 mark redraw took every arc and
 * circle out of the set on purpose (module-mark.tsx). It keeps the part-filled
 * reading that makes a ring legible as progress and stays in the same
 * draughtsman's vocabulary as the marks.
 *
 * Geometry is in a 24 unit box, like the mark, so the same paths serve 12px in
 * a table row and 20px on /dev/ui. Everything is `currentColor`: the glyph
 * takes the stage ink from whatever renders it and carries no colour of its
 * own, which is what lets one component serve seven hues.
 */

const BOX = 24;
const C = BOX / 2;
/** Circumradius. 10 leaves a unit of air on the tall axis at any size. */
const R = 10;
/** Centre to the middle of an edge. */
const APOTHEM = R * Math.cos(Math.PI / 6);

/** Two units is one pixel at 12px, which is the smallest this is drawn at. */
const STROKE = 2;
/** The marks inside run heavier, or they close up in a dense row. */
const MARK_STROKE = 2.4;

/** Clockwise from twelve o'clock, in degrees, the way the fills read. */
function point(angle: number, distance: number): [number, number] {
  const radians = (angle * Math.PI) / 180;
  return [C + distance * Math.sin(radians), C - distance * Math.cos(radians)];
}

/**
 * How far the hexagon's edge is at a given angle.
 *
 * Vertices sit at 0, 60, 120 … and the middle of each edge at 30, 90, 150 …,
 * so the distance is the apothem divided by the cosine of the angle off the
 * nearest edge midpoint. This is what lets a fill stop part way along an edge
 * instead of only at a corner.
 */
function edgeDistance(angle: number): number {
  const offEdgeMiddle = (((angle % 60) + 60) % 60) - 30;
  return APOTHEM / Math.cos((offEdgeMiddle * Math.PI) / 180);
}

function points(pairs: readonly [number, number][]): string {
  return pairs.map(([x, y]) => `${round(x)},${round(y)}`).join(' ');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const VERTICES: [number, number][] = [0, 60, 120, 180, 240, 300].map((angle) => point(angle, R));
const HEXAGON = points(VERTICES);

/**
 * The part of the hexagon swept clockwise from the top vertex.
 *
 * The centre, the top vertex, every corner the sweep passes, and wherever it
 * stops. A quarter therefore ends halfway down the upper right edge rather
 * than at a corner, which is what makes the four fills read as one motion.
 */
function wedge(fraction: number): string {
  const sweep = 360 * fraction;
  const corners = [60, 120, 180, 240, 300].filter((angle) => angle < sweep);
  return points([
    [C, C],
    point(0, R),
    ...corners.map((angle) => point(angle, R)),
    point(sweep, edgeDistance(sweep)),
  ]);
}

const FILLED: Partial<Record<GlyphName, number>> = {
  quarter: 0.25,
  half: 0.5,
  'three-quarters': 0.75,
};

/** Edge to edge, so a struck hexagon reads as struck and not as decorated. */
const SLASH = [point(225, edgeDistance(225)), point(45, edgeDistance(45))];
const BAR = [point(270, APOTHEM), point(90, APOTHEM)];

function Marks({ glyph }: { glyph: GlyphName }) {
  const fill = FILLED[glyph];
  if (fill !== undefined) {
    return <polygon points={wedge(fill)} fill="currentColor" stroke="none" />;
  }

  switch (glyph) {
    case 'check':
      // Set inside rather than struck across, because on /todo this glyph is
      // the toggle you click and a tick is what a person expects there.
      return (
        <polyline
          points="7.6,12.2 10.6,15.2 16.4,8.8"
          strokeWidth={MARK_STROKE}
          strokeLinecap="square"
        />
      );
    case 'cross':
      return (
        <g strokeWidth={MARK_STROKE} strokeLinecap="square">
          <line x1={8.2} y1={8.2} x2={15.8} y2={15.8} />
          <line x1={15.8} y1={8.2} x2={8.2} y2={15.8} />
        </g>
      );
    case 'question':
      // The one letterform in the set, and it curves where nothing else does.
      // A question mark is read as a shape rather than assembled from strokes,
      // so a straight-edged one would be a puzzle at 12px and a question mark
      // at 20px. The dot is a square of the same weight as the hook, which is
      // what keeps it from reading as a circle in a set that has none.
      return (
        <g strokeWidth={MARK_STROKE} strokeLinecap="square">
          <path d="M9.4 9.8 Q9.4 6.9 12 6.9 Q14.6 6.9 14.6 9.7 Q14.6 11.7 12 12.9 L12 14.1" />
          <rect x={10.8} y={15.9} width={2.4} height={2.4} fill="currentColor" stroke="none" />
        </g>
      );
    case 'slash':
      return (
        <line
          x1={round(SLASH[0][0])}
          y1={round(SLASH[0][1])}
          x2={round(SLASH[1][0])}
          y2={round(SLASH[1][1])}
          strokeWidth={MARK_STROKE}
        />
      );
    case 'bar':
      return (
        <line
          x1={round(BAR[0][0])}
          y1={round(BAR[0][1])}
          x2={round(BAR[1][0])}
          y2={round(BAR[1][1])}
          strokeWidth={MARK_STROKE}
        />
      );
    default:
      return null;
  }
}

export function StatusGlyph({
  glyph,
  /**
   * What the glyph means. Given one it is an image with that name; given none
   * it is decoration, which is the right answer wherever the label is already
   * written beside it.
   */
  label,
  size = 14,
  className,
}: {
  glyph: GlyphName;
  label?: string;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${BOX} ${BOX}`}
      className={cn('shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      role={label ? 'img' : undefined}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {label ? <title>{label}</title> : null}
      <Marks glyph={glyph} />
      <polygon
        points={HEXAGON}
        fill={glyph === 'full' ? 'currentColor' : 'none'}
        // Ten dashes of four units on a sixty unit perimeter, so the pattern
        // closes on itself instead of leaving a stub at the top vertex.
        strokeDasharray={glyph === 'dashed' ? '4 2' : undefined}
      />
    </svg>
  );
}
