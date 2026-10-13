import { useId } from 'react';
import { cn } from '@/lib/cn';
import { HOME_MARK, moduleById, type MarkShape, type ModuleId } from '@/lib/modules';
import { DashGlyph, GlassEdgeStops, GlassSheenStops, glassOutline, glassTint } from './dash-mark';

/**
 * One mark per module, all drawn the same way: two layers of one object.
 *
 * At the back is a solid shape in the module's hue, peeking out from the top
 * right. In front is a pane of frosted glass, and through it the back layer
 * shows blurred and a little displaced, which is what makes it read as glass.
 * The detail that names the object (the eyelet, the tick, the dial) is
 * drawn on the pane in white.
 *
 * On a light page the pane would vanish into the ground, so there it carries a
 * tint of the module's hue, a coloured edge, and the detail drawn in the deep
 * hue instead of white. CSS light-dark() makes that switch from the
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
 * module={null} is the app itself: Dash at rest on a dark plate, the same
 * drawing as app/icon.svg.
 */

const SIZES = {
  // Inline in a line of text, beside a row's title (note 134ec065).
  xs: { box: 'size-[18px]', px: 18 },
  sm: { box: 'size-6', px: 24 },
  md: { box: 'size-8', px: 32 },
  lg: { box: 'size-11', px: 44 },
} as const;

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

function GlassObject({
  id,
  drawing,
  from,
  to,
  px,
  tint,
}: {
  id: string;
  drawing: Drawing;
  from: string;
  to: string;
  px: number;
  tint?: number;
}) {
  const { back, front, frontTransform, lines, dots, onBack } = drawing;
  const pane = (props: React.SVGProps<SVGPathElement>) => <path d={front} transform={frontTransform} {...props} />;
  // White on dark, the deep hue on light, where white would vanish into the tint.
  // Glass tinted deep enough carries white in both.
  const ink = tint && tint >= 55 ? '#fff' : `light-dark(${to}, #fff)`;
  // Thicker as the mark gets smaller, so the detail survives at 18px.
  const weight = px <= 22 ? 2 : px <= 34 ? 1.65 : 1.35;

  return (
    <>
      <defs>
        <linearGradient id={`${id}-ramp`} gradientUnits="userSpaceOnUse" x1={4} y1={2} x2={20} y2={22}>
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <filter id={`${id}-blur`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
          <feGaussianBlur stdDeviation={1.25} />
        </filter>
        <clipPath id={`${id}-clip`}>{pane({})}</clipPath>
        <linearGradient id={`${id}-edge`} gradientUnits="userSpaceOnUse" x1={0} y1={3} x2={0} y2={22}>
          <GlassEdgeStops />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} gradientUnits="userSpaceOnUse" x1={0} y1={3} x2={0} y2={22}>
          {tint ? (
            // Tinted glass keeps the dark page's gentler sheen everywhere; the light one washes the colour out.
            <>
              <stop offset="0" stopColor="#fff" stopOpacity={0.28} />
              <stop offset="1" stopColor="#fff" stopOpacity={0.06} />
            </>
          ) : (
            <GlassSheenStops />
          )}
        </linearGradient>
        {tint && (
          // The glass itself in the hue, from the middle of the ramp down to the deep end, on
          // every page, so white detail holds even on the paler hues.
          <linearGradient id={`${id}-tint`} gradientUnits="userSpaceOnUse" x1={0} y1={3} x2={0} y2={22}>
            <stop offset="0" style={{ stopColor: `color-mix(in srgb, color-mix(in srgb, ${from} 55%, ${to}) ${tint}%, transparent)` }} />
            <stop offset="1" style={{ stopColor: `color-mix(in srgb, ${to} ${tint}%, transparent)` }} />
          </linearGradient>
        )}
      </defs>

      {/* A soft shadow in the hue, under the whole object. */}
      <g opacity={0.4} filter={`url(#${id}-blur)`} transform="translate(0 1.6)" fill={to}>
        {back}
        {pane({ opacity: 0.35 })}
      </g>
      <g fill={`url(#${id}-ramp)`}>{back}</g>
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
      {tint ? pane({ fill: `url(#${id}-tint)` }) : pane({ style: { fill: glassTint(from, 30) } })}
      {pane({ fill: `url(#${id}-sheen)` })}
      {pane({ strokeWidth: 0.8, style: { stroke: glassOutline(to) } })}
      {pane({ stroke: `url(#${id}-edge)`, strokeWidth: 0.55 })}
      <g
        fill="none"
        strokeWidth={weight}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ stroke: ink }}
      >
        {lines}
      </g>
      {dots && <g style={{ fill: ink }}>{dots}</g>}
    </>
  );
}

/** The app's own mark: Dash at rest on a dark plate. */
function HomePlate({ id }: { id: string }) {
  const plate = 'M6 0h12a6 6 0 0 1 6 6v12a6 6 0 0 1-6 6H6a6 6 0 0 1-6-6V6a6 6 0 0 1 6-6Z';
  return (
    <>
      <defs>
        <linearGradient id={`${id}-plate`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={24}>
          <stop offset="0" stopColor="#1a1b21" />
          <stop offset="1" stopColor="#0b0b0e" />
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
  tint,
}: {
  /** null means the app itself. */
  module: ModuleId | null;
  size?: keyof typeof SIZES;
  className?: string;
  /** How strongly the glass is tinted its hue, 0 to 100; unset is the clear glass. */
  tint?: number;
}) {
  const entry = moduleById(module);
  const sizing = SIZES[size];
  const id = `mark-${useId().replace(/:/g, '')}`;
  const key = entry?.key ?? HOME_MARK.key;

  return (
    <span className={cn('flex shrink-0 items-center justify-center', sizing.box, className)} aria-hidden>
      <svg width={sizing.px} height={sizing.px} viewBox="0 0 24 24" fill="none" overflow="visible">
        {key.shape === 'dash' ? (
          <HomePlate id={id} />
        ) : (
          <GlassObject id={id} drawing={DRAWINGS[key.shape]} from={key.from} to={key.to} px={sizing.px} tint={tint} />
        )}
      </svg>
    </span>
  );
}
