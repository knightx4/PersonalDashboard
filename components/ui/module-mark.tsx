import { useId } from 'react';
import { cn } from '@/lib/cn';
import { DASH_MARK, HOME_MARK, moduleById, type MarkKey, type MarkShape, type ModuleId } from '@/lib/modules';
import { DashGlyph, GlassEdgeStops, glassOutline } from './dash-mark';

/**
 * One mark per module, all drawn the same way: two layers of one object.
 *
 * At the back is a solid shape in the module's hue, peeking out from the top
 * right. In front is a pane of glass tinted in the same hue, and through it
 * the back layer shows blurred and a little displaced, which is what makes it
 * read as glass. The detail that names the object (the eyelet, the tick, the
 * dial) is drawn on the pane in white.
 *
 * The tint is the same on every page, so on a light page the ground shows
 * through and the pane reads paler. There the pane takes a coloured edge and
 * the detail is drawn in the deep hue instead of white. CSS light-dark() makes that switch from the
 * color-scheme of wherever the mark sits, so one drawing serves every theme,
 * and the light sheets inside Lightbox get the light version on their own.
 *
 * The drawings share one set of rules, and keeping them is what keeps the set
 * reading as one: the pane sits inside units 2.6 to 21.4, its corners come
 * from one scale (3.2 for a pane, 2 for a small part), every white line is the
 * same weight with round ends, and the colour layer peeks out from the same
 * corner. A new mark that breaks one of these will look like it came from a
 * different set.
 *
 * module={null} is Home: a house of thick, clear glass that splits light into
 * colour round its rim, where the other marks have a hue. module="dash" is Dash, and the
 * app itself: Dash at rest on a dark plate, the same drawing as app/icon.svg.
 */

const SIZES = {
  // Inline in a line of text, beside a row's title (note 134ec065).
  xs: { box: 'size-[18px]', px: 18 },
  sm: { box: 'size-6', px: 24 },
  md: { box: 'size-8', px: 32 },
  lg: { box: 'size-11', px: 44 },
} as const;

/** How strongly the pane is tinted its hue, as a percentage of the colour over what is behind it. */
const TINT = 48;

/** The price tag, pointing left; drawn turned 45 degrees so it points up and left. */
const TAG =
  'M9.6 7.4H18.8A2.6 2.6 0 0 1 21.4 10V14A2.6 2.6 0 0 1 18.8 16.6H9.6A2 2 0 0 1 8.25 16.07L4.1 12.74A.95.95 0 0 1 4.1 11.26L8.25 7.93A2 2 0 0 1 9.6 7.4Z';
const TAG_FRONT = 'translate(-.5 .9) rotate(45 12 12) translate(-.4 0)';

type Drawing = {
  /** The colour layer. */
  back: React.ReactNode;
  /** The glass pane, as one closed path. */
  front: string;
  frontTransform?: string;
  /** Lines on the glass, stroked. */
  lines: React.ReactNode;
  /** Small solid parts on the glass, filled in the same colour as the lines. */
  dots?: React.ReactNode;
  /** Drawn on the colour layer itself, in white. */
  onBack?: React.ReactNode;
  /**
   * For a prism mark only: the corners where thick glass bends light most, as
   * [x, y, radius], so the spectrum in the rim gathers there; and the light
   * caught on the glass, in white.
   */
  bends?: readonly (readonly [number, number, number])[];
  glints?: React.ReactNode;
  /**
   * For a prism mark only: the detail as a closed shape carved into the glass,
   * drawn with the same refraction as the rim, in place of `lines`.
   */
  recess?: string;
};

const DRAWINGS: Record<Exclude<MarkShape, 'dash'>, Drawing> = {
  tag: {
    // A second tag behind the first, like a stack of price tags.
    back: <path d={TAG} transform="translate(1.9 -1.9) rotate(45 12 12) translate(-.4 0)" />,
    front: TAG,
    frontTransform: TAG_FRONT,
    lines: <circle cx={8.9} cy={12} r={1.3} transform={TAG_FRONT} />,
  },
  briefcase: {
    // The handle and the lid are the colour; the handle rises out of the glass.
    back: (
      <>
        <path d="M8.4 9.2V6.9A2.3 2.3 0 0 1 10.7 4.6h2.6A2.3 2.3 0 0 1 15.6 6.9V9.2h-2.2V7.4a.6.6 0 0 0-.6-.6h-1.6a.6.6 0 0 0-.6.6v1.8Z" />
        <rect x={2.6} y={8.2} width={18.8} height={5.6} rx={3.2} />
      </>
    ),
    front:
      'M5.8 8.2h12.4a3.2 3.2 0 0 1 3.2 3.2v6.2a3.2 3.2 0 0 1-3.2 3.2H5.8a3.2 3.2 0 0 1-3.2-3.2v-6.2a3.2 3.2 0 0 1 3.2-3.2Z',
    lines: <path d="M3.4 13.6h6.4M14.2 13.6h6.4" />,
    dots: <rect x={10.4} y={12.3} width={3.2} height={2.6} rx={0.9} />,
  },
  check: {
    back: <rect x={8.4} y={2.6} width={13} height={13} rx={3.2} transform="rotate(8 14.9 9.1)" />,
    front:
      'M6 6.4h9.6a3.4 3.4 0 0 1 3.4 3.4v8.4a3.4 3.4 0 0 1-3.4 3.4H6a3.4 3.4 0 0 1-3.4-3.4V9.8A3.4 3.4 0 0 1 6 6.4Z',
    lines: <path d="M7 14.1l2.6 2.6 4.9-5.2" />,
  },
  safe: {
    // A safe door: a combination dial, a handle beside it, and feet.
    back: <circle cx={16.8} cy={7} r={4.6} />,
    front:
      'M6 3.8h12a3.2 3.2 0 0 1 3.2 3.2v9.6a3.2 3.2 0 0 1-3.2 3.2H6a3.2 3.2 0 0 1-3.2-3.2V7A3.2 3.2 0 0 1 6 3.8Z',
    lines: (
      <>
        <circle cx={10.6} cy={11.8} r={3.6} />
        <path d="M6.6 19.8v1.4M17.4 19.8v1.4" />
      </>
    ),
    // The dial's knob and its four notches, and the handle beside it.
    dots: (
      <>
        <circle cx={10.6} cy={11.8} r={1.25} />
        <circle cx={10.6} cy={9.15} r={0.5} />
        <circle cx={13.25} cy={11.8} r={0.5} />
        <circle cx={10.6} cy={14.45} r={0.5} />
        <circle cx={7.95} cy={11.8} r={0.5} />
        <rect x={16.2} y={9.2} width={1.8} height={5.2} rx={0.9} />
      </>
    ),
  },
  book: {
    // The whole open book in glass, with a coloured ribbon marking the place.
    back: <path d="M14.8 2.6h3.4v8.6l-1.7-1.4-1.7 1.4Z" />,
    front:
      'M12 7.2C10 5.7 7 5.1 3.5 5.4a.7.7 0 0 0-.6.7v12a.6.6 0 0 0 .66.6C7 18.4 9.9 19 12 20.6c2.1-1.6 5-2.2 8.44-1.9a.6.6 0 0 0 .66-.6v-12a.7.7 0 0 0-.6-.7C17 5.1 14 5.7 12 7.2Z',
    lines: <path d="M12 7.6v12.6M5.6 9.3c1.7-.1 3.2.2 4.4.8M5.6 12.6c1.2-.05 2.3.1 3.2.4" />,
  },
  envelope: {
    // A letter rising out of its envelope. Rounded all round, so no square
    // corner shows through the glass.
    back: <rect x={6} y={2.6} width={12} height={11.4} rx={2} />,
    onBack: <path d="M8.8 5.6h6.4M8.8 7.8h4.2" />,
    front:
      'M5.8 9h12.4a3.2 3.2 0 0 1 3.2 3.2v6a3.2 3.2 0 0 1-3.2 3.2H5.8a3.2 3.2 0 0 1-3.2-3.2v-6A3.2 3.2 0 0 1 5.8 9Z',
    lines: <path d="M3.6 10.3 12 15.9l8.4-5.6" />,
  },
  summit: {
    // A glass mountain in front of a coloured peak, a pennant on the summit.
    back: <path d="M10.4 15.4 15.3 6.5a1.5 1.5 0 0 1 2.62 0l4.1 7.4a1 1 0 0 1-.87 1.5Z" />,
    front:
      'M2.9 19.2 8.8 9.1a1.6 1.6 0 0 1 2.76 0l2.4 4.1 1.3-2.1a1.6 1.6 0 0 1 2.72 0l5.12 8.1a1.3 1.3 0 0 1-1.1 2H4a1.3 1.3 0 0 1-1.1-2Z',
    lines: <path d="M10.2 8.4V3.2" strokeWidth={1.1} />,
    dots: (
      <path d="M10.2 3.3c1.15-.65 2.2.45 3.5-.1a.3.3 0 0 1 .42.28v2.35a.4.4 0 0 1-.24.37c-1.3.55-2.35-.55-3.68.1Z" />
    ),
  },
  house: {
    // A glass house with its chimney behind, and the arch of a door.
    back: <rect x={15} y={2.6} width={4} height={8} rx={1.6} />,
    front:
      'M10.47 4.59Q12 3.3 13.53 4.59L19.98 10.07Q21.2 11.1 21.2 12.7V18A3.2 3.2 0 0 1 18 21.2H6A3.2 3.2 0 0 1 2.8 18V12.7Q2.8 11.1 4.02 10.07Z',
    lines: <path d="M9.9 20.4V17.3a2.1 2.1 0 0 1 4.2 0v3.1" />,
    // The door, carved into the glass rather than drawn on it.
    recess: 'M9.7 21.4V17.3a2.3 2.3 0 0 1 4.6 0v4.1Z',
    // The peak, the two eaves and the two foot corners.
    bends: [
      [12, 4.2, 4.2],
      [3.6, 11.6, 3.4],
      [20.4, 11.6, 3.4],
      [4.6, 19.4, 3.6],
      [19.4, 19.4, 3.6],
    ],
    // A streak along the lit slope of the roof, and a point of light at the peak.
    glints: (
      <>
        <path d="M4.9 11.3 10.5 6.5" stroke="#fff" strokeWidth={0.9} strokeLinecap="round" />
        <circle cx={12} cy={5.3} r={0.5} fill="#fff" />
      </>
    ),
  },
  person: {
    // A bust: the head is the colour, sitting into a pair of glass shoulders,
    // and the V of a collar is what makes the pane shoulders rather than a hill.
    back: <circle cx={12} cy={7.8} r={5.2} />,
    front:
      'M9 12.4h6a6.4 6.4 0 0 1 6.4 6.4v.6a2 2 0 0 1-2 2H4.6a2 2 0 0 1-2-2v-.6A6.4 6.4 0 0 1 9 12.4Z',
    lines: <path d="M9.4 13.6l2.6 2.8 2.6-2.8" />,
  },
  terminal: {
    back: <rect x={9.4} y={2.6} width={12} height={9.2} rx={2.4} />,
    front:
      'M6 6h12.2a3.2 3.2 0 0 1 3.2 3.2v8.4a3.2 3.2 0 0 1-3.2 3.2H6a3.2 3.2 0 0 1-3.2-3.2V9.2A3.2 3.2 0 0 1 6 6Z',
    lines: <path d="M6.6 12.4l2.5 2.1-2.5 2.1M11.4 17.2h4.8" />,
    dots: (
      <>
        <circle cx={5.7} cy={8.7} r={0.7} />
        <circle cx={7.8} cy={8.7} r={0.7} />
        <circle cx={9.9} cy={8.7} r={0.7} />
      </>
    ),
  },
};

/**
 * The colours a prism mark's glass splits light into: deep cobalt and electric
 * cyan, a little lime, then amber, orange and magenta into violet, the
 * saturated dispersion of very refractive glass rather than a flat rainbow.
 * It runs corner to corner across the mark, so each part of the rim takes a
 * different colour, as the edge of a thick piece of glass does.
 */
const SPECTRUM = [
  { offset: 0, colour: '#1d3cff' },
  { offset: 0.16, colour: '#2f9bff' },
  { offset: 0.3, colour: '#3fe6ff' },
  { offset: 0.4, colour: '#cfff4a' },
  { offset: 0.5, colour: '#ffb21e' },
  { offset: 0.62, colour: '#ff5a14' },
  { offset: 0.76, colour: '#ff2e8a' },
  { offset: 0.9, colour: '#7a2cff' },
  { offset: 1, colour: '#1d3cff' },
] as const;

/** The rim's spectrum away from the bends: there, but faint. */
const RIM_FLOOR = 0.32;

function GlassObject({
  id,
  drawing,
  from,
  to,
  px,
  prism = false,
}: {
  id: string;
  drawing: Drawing;
  from: string;
  to: string;
  px: number;
  prism?: boolean;
}) {
  const { back, front, frontTransform, lines, dots, onBack } = drawing;
  // A prism mark carves its detail into the glass instead of drawing it on.
  const recess = prism ? drawing.recess : undefined;
  const pane = (props: React.SVGProps<SVGPathElement>) => <path d={front} transform={frontTransform} {...props} />;
  // White on dark, the deep hue on light, where white would not hold against the tint.
  // A white pane takes its deep end on both, since white lines would vanish on it.
  const ink = prism ? to : `light-dark(${to}, #fff)`;
  // A white pane is close to opaque, or the dark ground turns it grey.
  const tintTop = prism
    ? `color-mix(in srgb, ${from} 86%, transparent)`
    : `color-mix(in srgb, color-mix(in srgb, ${from} 55%, ${to}) ${TINT}%, transparent)`;
  const tintBottom = prism
    ? `color-mix(in srgb, color-mix(in srgb, ${from} 72%, ${to}) 80%, transparent)`
    : `color-mix(in srgb, ${to} ${TINT}%, transparent)`;
  // Thicker as the mark gets smaller, so the detail survives at 18px.
  const weight = px <= 22 ? 2 : px <= 34 ? 1.65 : 1.35;

  return (
    <>
      <defs>
        <linearGradient id={`${id}-ramp`} gradientUnits="userSpaceOnUse" x1={4} y1={2} x2={20} y2={22}>
          <stop offset="0" stopColor={from} />
          {/* A prism mark's colour layer is silver, paler than its ink. */}
          <stop offset="1" stopColor={prism ? '#9aa4b8' : to} />
        </linearGradient>
        <filter id={`${id}-blur`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
          <feGaussianBlur stdDeviation={1.25} />
        </filter>
        <clipPath id={`${id}-clip`}>{pane({})}</clipPath>
        <linearGradient id={`${id}-edge`} gradientUnits="userSpaceOnUse" x1={0} y1={3} x2={0} y2={22}>
          <GlassEdgeStops />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} gradientUnits="userSpaceOnUse" x1={0} y1={3} x2={0} y2={22}>
          {/* The dark page's gentle sheen on every page: the light page's would wash the tint out. */}
          <stop offset="0" stopColor="#fff" stopOpacity={0.28} />
          <stop offset="1" stopColor="#fff" stopOpacity={0.06} />
        </linearGradient>
        {/* The glass itself in the hue, from the middle of the ramp down to the deep end. */}
        <linearGradient id={`${id}-tint`} gradientUnits="userSpaceOnUse" x1={0} y1={3} x2={0} y2={22}>
          <stop offset="0" style={{ stopColor: tintTop }} />
          <stop offset="1" style={{ stopColor: tintBottom }} />
        </linearGradient>
        {prism && (
          <>
            {/* Corner to corner, and the same the other way for the inner rim. */}
            <linearGradient id={`${id}-spectrum`} gradientUnits="userSpaceOnUse" x1={3} y1={3} x2={21} y2={21}>
              {SPECTRUM.map((stop) => (
                <stop key={stop.colour} offset={stop.offset} stopColor={stop.colour} />
              ))}
            </linearGradient>
            <linearGradient id={`${id}-reverse`} gradientUnits="userSpaceOnUse" x1={21} y1={21} x2={3} y2={3}>
              {SPECTRUM.map((stop) => (
                <stop key={stop.colour} offset={stop.offset} stopColor={stop.colour} />
              ))}
            </linearGradient>
            <linearGradient id={`${id}-caustic`} gradientUnits="userSpaceOnUse" x1={3} y1={0} x2={21} y2={0}>
              {SPECTRUM.map((stop) => (
                <stop key={stop.colour} offset={stop.offset} stopColor={stop.colour} />
              ))}
            </linearGradient>
            <filter id={`${id}-soft`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
              <feGaussianBlur stdDeviation={0.55} />
            </filter>
            <filter id={`${id}-fine`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
              <feGaussianBlur stdDeviation={0.22} />
            </filter>
            <filter id={`${id}-wide`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
              <feGaussianBlur stdDeviation={1.1} />
            </filter>
            {/* The dark a thick edge refracts in from round the object: cobalt
                under the lit top, deepening to navy at the foot. */}
            <linearGradient id={`${id}-depth`} gradientUnits="userSpaceOnUse" x1={0} y1={3} x2={0} y2={22}>
              <stop offset="0" stopColor="#2a3fd0" stopOpacity={0.45} />
              <stop offset="1" stopColor="#0a0f45" stopOpacity={0.9} />
            </linearGradient>
            <clipPath id={`${id}-back-clip`}>{back}</clipPath>
            {recess && (
              <>
                <clipPath id={`${id}-recess-clip`}>
                  <path d={recess} />
                </clipPath>
                {/* The cut's own spread of the spectrum, cool on its lit side
                    to warm on the far one, as the rim runs across the mark. */}
                <linearGradient id={`${id}-recess-light`} gradientUnits="userSpaceOnUse" x1={9.2} y1={15} x2={14.8} y2={21.4}>
                  {SPECTRUM.map((stop) => (
                    <stop key={stop.colour} offset={stop.offset} stopColor={stop.colour} />
                  ))}
                </linearGradient>
              </>
            )}
            {/* Where the rim's spectrum shows: faintly everywhere, fully at the bends. */}
            {drawing.bends?.map(([cx, cy, r], i) => (
              <radialGradient key={i} id={`${id}-bend-${i}`} gradientUnits="userSpaceOnUse" cx={cx} cy={cy} r={r}>
                <stop offset="0" stopColor="#fff" />
                <stop offset="1" stopColor="#fff" stopOpacity={0} />
              </radialGradient>
            ))}
            <mask id={`${id}-bends`} maskUnits="userSpaceOnUse" x={0} y={0} width={24} height={24}>
              <rect width={24} height={24} fill="#fff" fillOpacity={RIM_FLOOR} />
              {drawing.bends?.map(([cx, cy, r], i) => (
                <circle key={i} cx={cx} cy={cy} r={r} fill={`url(#${id}-bend-${i})`} />
              ))}
            </mask>
          </>
        )}
      </defs>

      {/* Light the glass has split, thrown on the ground beneath it. */}
      {prism && (
        <ellipse
          cx={12}
          cy={22.6}
          rx={8.4}
          ry={1.1}
          fill={`url(#${id}-caustic)`}
          opacity={0.3}
          filter={`url(#${id}-wide)`}
        />
      )}
      {/* A soft shadow in the hue, under the whole object. */}
      <g opacity={0.4} filter={`url(#${id}-blur)`} transform="translate(0 1.6)" fill={to}>
        {back}
        {pane({ opacity: 0.35 })}
      </g>
      <g fill={`url(#${id}-ramp)`}>{back}</g>
      {prism && (
        // The colour layer is glass too, with a thin rim of its own.
        <g clipPath={`url(#${id}-back-clip)`}>
          <g filter={`url(#${id}-fine)`} fill="none" stroke={`url(#${id}-reverse)`} strokeWidth={1.1} opacity={0.55}>
            {back}
          </g>
        </g>
      )}
      {onBack && (
        <g stroke="#fff" strokeOpacity={0.85} strokeWidth={1.2} strokeLinecap="round">
          {onBack}
        </g>
      )}
      {/* The colour layer seen through the glass: blurred, and nudged as glass bends it. */}
      <g clipPath={`url(#${id}-clip)`}>
        <g fill={`url(#${id}-ramp)`} filter={`url(#${id}-blur)`} transform="translate(-.5 .7)">
          {back}
        </g>
      </g>
      {pane({ fill: `url(#${id}-tint)` })}
      {pane({ fill: `url(#${id}-sheen)` })}
      {prism && (
        <>
          {/* Thick glass seen the way it refracts: a deep band inside the edge,
              where the glass bends in the dark around it; the spectrum caught
              in the rim over that dark, gathered at the corners where it bends
              light most; a sharper fringe where the band meets the clear
              middle; a faint rim inside that running the other way, as light
              reflected back through the glass does; and the light caught on
              the glass. */}
          <g clipPath={`url(#${id}-clip)`}>
            {pane({ stroke: `url(#${id}-depth)`, strokeWidth: 4.2, filter: `url(#${id}-soft)` })}
          </g>
          <g clipPath={`url(#${id}-clip)`} mask={`url(#${id}-bends)`}>
            {pane({ stroke: `url(#${id}-spectrum)`, strokeWidth: 2.2, opacity: 0.65, filter: `url(#${id}-soft)` })}
            <g transform="translate(12 12.6) scale(.88) translate(-12 -12.6)">
              {pane({ stroke: `url(#${id}-spectrum)`, strokeWidth: 0.75, filter: `url(#${id}-fine)` })}
            </g>
          </g>
          <g clipPath={`url(#${id}-clip)`} filter={`url(#${id}-fine)`}>
            {/* The edge face itself, catching the light. */}
            {pane({ stroke: '#fff', strokeWidth: 1, strokeOpacity: 0.8 })}
            <g transform="translate(12 12.6) scale(.8) translate(-12 -12.6)">
              {pane({ stroke: `url(#${id}-reverse)`, strokeWidth: 0.4, opacity: 0.45 })}
            </g>
            {drawing.glints}
          </g>
        </>
      )}
      {pane({ strokeWidth: 0.8, style: { stroke: glassOutline(to) } })}
      {pane({ stroke: `url(#${id}-edge)`, strokeWidth: 0.55 })}
      {recess ? (
        // The detail carved into the glass, seen the way the rim is: dark where
        // the cut bends in the light around it, the spectrum round its edge,
        // and the edge of the cut catching the light.
        <g clipPath={`url(#${id}-clip)`}>
          <path d={recess} fill={`url(#${id}-depth)`} opacity={0.7} />
          <g clipPath={`url(#${id}-recess-clip)`} filter={`url(#${id}-soft)`}>
            <path d={recess} fill="none" stroke={`url(#${id}-recess-light)`} strokeWidth={1.8} opacity={0.8} />
          </g>
          <path
            d={recess}
            fill="none"
            stroke="#fff"
            strokeWidth={0.45}
            strokeOpacity={0.75}
            filter={`url(#${id}-fine)`}
          />
        </g>
      ) : (
        <g
          fill="none"
          strokeWidth={weight}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ stroke: ink }}
        >
          {lines}
        </g>
      )}
      {dots && <g style={{ fill: ink }}>{dots}</g>}
    </>
  );
}

/** Dash's mark, and the app's: Dash at rest on a dark charcoal plate (note 49ba62cf). */
function DashPlate({ id }: { id: string }) {
  const plate = 'M6 0h12a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V6a6 6 0 0 1 6-6Z';
  return (
    <>
      <defs>
        <linearGradient id={`${id}-plate`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={24}>
          <stop offset="0" stopColor="#34353c" />
          <stop offset="1" stopColor="#222328" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={24}>
          <stop offset="0" stopColor="#fff" stopOpacity={0.07} />
          <stop offset="0.5" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={plate} fill={`url(#${id}-plate)`} />
      <path d={plate} fill={`url(#${id}-shine)`} />
      <path d={plate} stroke="#fff" strokeOpacity={0.14} strokeWidth={0.5} />
      {/* The plate is always dark, so the glass on it always takes its dark look. */}
      <g transform="translate(1.3 1.3) scale(.89)" style={{ colorScheme: 'dark' }}>
        <DashGlyph id={`${id}-dash`} state="idle" tone="brand" />
      </g>
    </>
  );
}

export function ModuleMark({
  module,
  size = 'md',
  className,
}: {
  /** null means Home, and 'dash' means Dash, which is also the app's own mark. */
  module: ModuleId | null | 'dash';
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const sizing = SIZES[size];
  const id = `mark-${useId().replace(/:/g, '')}`;
  const key: MarkKey =
    module === 'dash' ? DASH_MARK.key : (moduleById(module)?.key ?? HOME_MARK.key);

  return (
    <span className={cn('flex shrink-0 items-center justify-center', sizing.box, className)} aria-hidden>
      <svg width={sizing.px} height={sizing.px} viewBox="0 0 24 24" fill="none" overflow="visible">
        {key.shape === 'dash' ? (
          <DashPlate id={id} />
        ) : (
          <GlassObject
            id={id}
            drawing={DRAWINGS[key.shape]}
            from={key.from}
            to={key.to}
            px={sizing.px}
            prism={key.prism}
          />
        )}
      </svg>
    </span>
  );
}
