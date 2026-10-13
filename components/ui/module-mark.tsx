import { useId } from 'react';
import { cn } from '@/lib/cn';
import { HOME_MARK, moduleById, type MarkShape, type ModuleId } from '@/lib/modules';
import { DashGlyph, GlassEdgeStops } from './dash-mark';

/**
 * One mark per module, all drawn the same way: two layers of one object.
 *
 * At the back is a solid shape in the module's deepest hue, peeking out from
 * the top right. In front is a pane in the module's own colour, solid so it
 * reads on any ground, with a little glass to it: the back piece shows faintly
 * through, a sheen lies across the top and the edge is lit. The detail that
 * names the object (the eyelet, the tick, the dial) is drawn on the pane in
 * white. The pane runs from the light end of the hue towards the deep end, so
 * the white holds even on the paler hues.
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

export type MarkFinish = 'solid' | 'glow' | 'soft' | 'rim' | 'lens' | 'lens-crisp' | 'glint' | 'glint-tint';

/**
 * How each finish lights the pane. `top` and `bottom` are how much of the
 * light end of the hue each end of the pane keeps (the rest is the deep end).
 */
const FINISHES: Record<
  MarkFinish,
  {
    top: number;
    bottom: number;
    sheen: number;
    halo: number;
    core: number;
    highlight: number;
    back: number;
    rim: number;
    shadow: boolean;
  }
> = {
  solid: { top: 78, bottom: 30, sheen: 0.42, halo: 0, core: 0, highlight: 0, back: 0.35, rim: 0, shadow: false },
  glow: { top: 100, bottom: 55, sheen: 0.55, halo: 0.55, core: 0.85, highlight: 0.28, back: 0.5, rim: 0, shadow: false },
  // Light kept inside the pane and low in it, under the detail rather than behind it.
  soft: { top: 88, bottom: 42, sheen: 0.45, halo: 0, core: 0.5, highlight: 0.2, back: 0.42, rim: 0, shadow: true },
  // An even pane with the light caught round its inside edge, like thick glass.
  rim: { top: 72, bottom: 38, sheen: 0.32, halo: 0, core: 0, highlight: 0.14, back: 0.4, rim: 0.75, shadow: true },
  // The lens finishes are drawn by LensObject; these values are unused.
  lens: { top: 0, bottom: 0, sheen: 0, halo: 0, core: 0, highlight: 0, back: 0, rim: 0, shadow: true },
  'lens-crisp': { top: 0, bottom: 0, sheen: 0, halo: 0, core: 0, highlight: 0, back: 0, rim: 0, shadow: true },
  glint: { top: 0, bottom: 0, sheen: 0, halo: 0, core: 0, highlight: 0, back: 0, rim: 0, shadow: true },
  'glint-tint': { top: 0, bottom: 0, sheen: 0, halo: 0, core: 0, highlight: 0, back: 0, rim: 0, shadow: true },
};

/**
 * Smoked glass with a hairline edge, and light catching the edge in a few
 * bright glints that bloom softly. The module's colour is the light behind
 * the glass (`glint`), or the glass itself (`glint-tint`).
 */
function GlintObject({
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
  tint: boolean;
}) {
  const { back, front, frontTransform, lines, dots, onBack } = drawing;
  const pane = (props: React.SVGProps<SVGPathElement>) => <path d={front} transform={frontTransform} {...props} />;
  const weight = px <= 22 ? 2 : px <= 34 ? 1.65 : 1.35;
  const spark = `color-mix(in srgb, ${from} 35%, #fff)`;
  const detail = (colour: string) => (
    <>
      <g fill="none" stroke={colour} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round">
        {lines}
      </g>
      {dots && <g fill={colour}>{dots}</g>}
    </>
  );
  // Smoked, but not near-black: enough of the hue in the glass that it reads as coloured glass.
  const glassTop = tint ? `color-mix(in srgb, ${from} 55%, ${to})` : `color-mix(in srgb, ${to} 50%, #2a2e3d)`;
  const glassBottom = tint ? `color-mix(in srgb, ${to} 80%, #1a1c26)` : `color-mix(in srgb, ${to} 34%, #1b1e29)`;

  return (
    <>
      <defs>
        <linearGradient id={`${id}-glass`} gradientUnits="userSpaceOnUse" x1={0} y1={3} x2={0} y2={22}>
          <stop offset="0" style={{ stopColor: glassTop }} />
          <stop offset="1" style={{ stopColor: glassBottom }} />
        </linearGradient>
        <linearGradient id={`${id}-back`} gradientUnits="userSpaceOnUse" x1={4} y1={2} x2={20} y2={22}>
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <filter id={`${id}-blur`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
          <feGaussianBlur stdDeviation={1.4} />
        </filter>
        <filter id={`${id}-bloom`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
          <feGaussianBlur stdDeviation={0.9} />
        </filter>
        <filter id={`${id}-soft`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
          <feGaussianBlur stdDeviation={0.5} />
        </filter>
        <clipPath id={`${id}-clip`}>{pane({})}</clipPath>
        {/* Where the light catches the edge: the top, the lower right, and faintly the left. */}
        <radialGradient id={`${id}-g1`} gradientUnits="userSpaceOnUse" cx={13} cy={3.5} r={6}>
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${id}-g2`} gradientUnits="userSpaceOnUse" cx={20.5} cy={19.5} r={4.5}>
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
        <radialGradient id={`${id}-g3`} gradientUnits="userSpaceOnUse" cx={2.8} cy={12} r={3.5}>
          <stop offset="0" stopColor="#fff" stopOpacity={0.6} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
        <mask id={`${id}-glints`} maskUnits="userSpaceOnUse" x={-4} y={-4} width={32} height={32}>
          <rect x={-4} y={-4} width={32} height={32} fill={`url(#${id}-g1)`} />
          <rect x={-4} y={-4} width={32} height={32} fill={`url(#${id}-g2)`} />
          <rect x={-4} y={-4} width={32} height={32} fill={`url(#${id}-g3)`} />
        </mask>
        <linearGradient id={`${id}-sheen`} gradientUnits="userSpaceOnUse" x1={0} y1={3} x2={0} y2={22}>
          <stop offset="0" stopColor="#fff" stopOpacity={0.16} />
          <stop offset="0.45" stopColor="#fff" stopOpacity={0.02} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* A soft shadow under the whole object. */}
      <g opacity={0.4} filter={`url(#${id}-blur)`} transform="translate(0 1.6)" fill="#000">
        {pane({})}
      </g>
      {/* The colour behind the glass. */}
      <g fill={`url(#${id}-back)`}>{back}</g>
      {onBack && (
        <g stroke="#fff" strokeOpacity={0.85} strokeWidth={1.2} strokeLinecap="round">
          {onBack}
        </g>
      )}
      {pane({ fill: `url(#${id}-glass)`, opacity: 0.9 })}
      <g clipPath={`url(#${id}-clip)`}>
        {/* The colour seen through the smoked glass, softened. */}
        <g fill={`url(#${id}-back)`} filter={`url(#${id}-blur)`} opacity={tint ? 0.55 : 0.8} transform="translate(-.5 .7)">
          {back}
        </g>
        {!tint && (
          <g filter={`url(#${id}-blur)`} opacity={0.5} transform="translate(12 15) scale(.7 .55) translate(-12 -15)">
            {pane({ fill: from })}
          </g>
        )}
      </g>
      {pane({ fill: `url(#${id}-sheen)` })}
      {/* The hairline edge. */}
      {pane({ stroke: '#fff', strokeOpacity: 0.32, strokeWidth: 0.4 })}
      {/* The glints, and their bloom. */}
      <g mask={`url(#${id}-glints)`}>
        <g filter={`url(#${id}-bloom)`} opacity={0.9}>
          {pane({ strokeWidth: 1.8, style: { stroke: spark } })}
        </g>
        {pane({ stroke: '#fff', strokeWidth: 0.6 })}
      </g>
      <g opacity={0.3} filter={`url(#${id}-soft)`} transform="translate(0 .4)">
        {detail(`color-mix(in srgb, ${to} 70%, #000)`)}
      </g>
      {detail('#fff')}
    </>
  );
}

/**
 * Built the way Dash's capsule is: the colour is a core sitting inside the
 * pane, with a band of glass between it and the edge and a bright rim round
 * the outside. `lens` blurs the core so it glows into the band, as the
 * capsule's does; `lens-crisp` keeps its edge sharp.
 */
function LensObject({
  id,
  drawing,
  from,
  to,
  px,
  crisp,
}: {
  id: string;
  drawing: Drawing;
  from: string;
  to: string;
  px: number;
  crisp: boolean;
}) {
  const { back, front, frontTransform, lines, dots, onBack } = drawing;
  const pane = (props: React.SVGProps<SVGPathElement>) => <path d={front} transform={frontTransform} {...props} />;
  const weight = px <= 22 ? 2 : px <= 34 ? 1.65 : 1.35;
  // The core, drawn smaller than the pane so a band of glass shows round it.
  const inset = 'translate(12 12.4) scale(.74) translate(-12 -12.4)';
  const detail = (colour: string) => (
    <>
      <g fill="none" stroke={colour} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round">
        {lines}
      </g>
      {dots && <g fill={colour}>{dots}</g>}
    </>
  );

  return (
    <>
      <defs>
        <linearGradient id={`${id}-back`} gradientUnits="userSpaceOnUse" x1={4} y1={2} x2={20} y2={22}>
          <stop offset="0" stopColor={to} />
          <stop offset="1" style={{ stopColor: `color-mix(in srgb, ${to} 70%, #000)` }} />
        </linearGradient>
        <linearGradient id={`${id}-core`} gradientUnits="userSpaceOnUse" x1={4} y1={4} x2={20} y2={20}>
          <stop offset="0" stopColor={from} />
          <stop offset="1" style={{ stopColor: `color-mix(in srgb, ${from} 45%, ${to})` }} />
        </linearGradient>
        <filter id={`${id}-blur`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
          <feGaussianBlur stdDeviation={1.25} />
        </filter>
        <filter id={`${id}-glow`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
          <feGaussianBlur stdDeviation={crisp ? 0.35 : 1.1} />
        </filter>
        <filter id={`${id}-soft`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
          <feGaussianBlur stdDeviation={0.45} />
        </filter>
        <clipPath id={`${id}-clip`}>{pane({})}</clipPath>
        <linearGradient id={`${id}-edge`} gradientUnits="userSpaceOnUse" x1={0} y1={3} x2={0} y2={22}>
          <GlassEdgeStops />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} gradientUnits="userSpaceOnUse" x1={0} y1={3} x2={0} y2={22}>
          <stop offset="0" stopColor="#fff" stopOpacity={0.34} />
          <stop offset="0.55" stopColor="#fff" stopOpacity={0.06} />
          <stop offset="1" stopColor="#fff" stopOpacity={0.14} />
        </linearGradient>
      </defs>

      <g opacity={0.35} filter={`url(#${id}-blur)`} transform="translate(0 1.6)" fill={to}>
        {back}
        {pane({})}
      </g>
      <g fill={`url(#${id}-back)`}>{back}</g>
      {onBack && (
        <g stroke="#fff" strokeOpacity={0.85} strokeWidth={1.2} strokeLinecap="round">
          {onBack}
        </g>
      )}
      {/* The glass itself: smoked dark on dark grounds, tinted on light ones, so the band reads on both. */}
      {pane({ style: { fill: `light-dark(color-mix(in srgb, ${from} 30%, #fff), color-mix(in srgb, ${to} 35%, #0b0c12))` } })}
      <g clipPath={`url(#${id}-clip)`}>
        <g fill={to} filter={`url(#${id}-blur)`} opacity={0.45} transform="translate(-.5 .7)">
          {back}
        </g>
        {/* The core, glowing into the band round it. */}
        <g filter={`url(#${id}-glow)`}>
          <g transform={inset}>{pane({ fill: `url(#${id}-core)` })}</g>
          {!crisp && <g transform={inset}>{pane({ fill: `url(#${id}-core)`, opacity: 0.6 })}</g>}
        </g>
      </g>
      {pane({ fill: `url(#${id}-sheen)` })}
      {pane({ strokeWidth: 0.6, style: { stroke: `color-mix(in srgb, ${to} 60%, transparent)` } })}
      {/* The bright glass rim, the capsule's most distinct feature. */}
      {pane({ stroke: `url(#${id}-edge)`, strokeWidth: 1.15 })}
      <g opacity={0.45} filter={`url(#${id}-soft)`} transform="translate(0 .5)">
        {detail(`color-mix(in srgb, ${to} 75%, #000)`)}
      </g>
      {detail('#fff')}
    </>
  );
}

function GlassObject({
  id,
  drawing,
  from,
  to,
  px,
  finish = 'solid',
}: {
  id: string;
  drawing: Drawing;
  from: string;
  to: string;
  px: number;
  finish?: MarkFinish;
}) {
  const { back, front, frontTransform, lines, dots, onBack } = drawing;
  const pane = (props: React.SVGProps<SVGPathElement>) => <path d={front} transform={frontTransform} {...props} />;
  const look = FINISHES[finish];
  // Thicker as the mark gets smaller, so the detail survives at 18px.
  const weight = px <= 22 ? 2 : px <= 34 ? 1.65 : 1.35;
  // The pane runs from the light end of the hue down towards the deep end, so
  // white detail holds on it even for the paler hues (Vault, News).
  const paneTop = `color-mix(in srgb, ${from} ${look.top}%, ${to})`;
  const paneBottom = `color-mix(in srgb, ${from} ${look.bottom}%, ${to})`;
  const light = `color-mix(in srgb, ${from} 55%, #fff)`;
  const detail = (colour: string) => (
    <>
      <g fill="none" stroke={colour} strokeWidth={weight} strokeLinecap="round" strokeLinejoin="round">
        {lines}
      </g>
      {dots && <g fill={colour}>{dots}</g>}
    </>
  );

  return (
    <>
      <defs>
        <linearGradient id={`${id}-back`} gradientUnits="userSpaceOnUse" x1={4} y1={2} x2={20} y2={22}>
          <stop offset="0" stopColor={to} />
          <stop offset="1" style={{ stopColor: `color-mix(in srgb, ${to} 70%, #000)` }} />
        </linearGradient>
        <linearGradient id={`${id}-pane`} gradientUnits="userSpaceOnUse" x1={0} y1={3} x2={0} y2={22}>
          <stop offset="0" style={{ stopColor: paneTop }} />
          <stop offset="1" style={{ stopColor: paneBottom }} />
        </linearGradient>
        <filter id={`${id}-blur`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
          <feGaussianBlur stdDeviation={1.25} />
        </filter>
        <filter id={`${id}-halo`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
          <feGaussianBlur stdDeviation={2.2} />
        </filter>
        <filter id={`${id}-soft`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
          <feGaussianBlur stdDeviation={0.45} />
        </filter>
        <clipPath id={`${id}-clip`}>{pane({})}</clipPath>
        <linearGradient id={`${id}-edge`} gradientUnits="userSpaceOnUse" x1={0} y1={3} x2={0} y2={22}>
          <GlassEdgeStops />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} gradientUnits="userSpaceOnUse" x1={0} y1={3} x2={0} y2={22}>
          <stop offset="0" stopColor="#fff" stopOpacity={look.sheen} />
          <stop offset="0.5" stopColor="#fff" stopOpacity={look.sheen * 0.18} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* A soft shadow in the hue, under the whole object. */}
      <g opacity={0.35} filter={`url(#${id}-blur)`} transform="translate(0 1.6)" fill={to}>
        {back}
        {pane({})}
      </g>
      {look.halo > 0 && <g opacity={look.halo} filter={`url(#${id}-halo)`}>{pane({ fill: from })}</g>}
      <g fill={`url(#${id}-back)`}>{back}</g>
      {onBack && (
        <g stroke="#fff" strokeOpacity={0.85} strokeWidth={1.2} strokeLinecap="round">
          {onBack}
        </g>
      )}
      {pane({ fill: `url(#${id}-pane)` })}
      <g clipPath={`url(#${id}-clip)`}>
        {/* The back piece, seen faintly through the glass. */}
        <g fill={to} filter={`url(#${id}-blur)`} opacity={look.back} transform="translate(-.5 .7)">
          {back}
        </g>
        {look.core > 0 && (
          <g
            filter={`url(#${id}-halo)`}
            transform={finish === 'soft' ? 'translate(12 18) scale(.6 .4) translate(-12 -18)' : 'translate(12 13) scale(.55) translate(-12 -13)'}
            opacity={look.core}
          >
            {pane({ style: { fill: light } })}
          </g>
        )}
        {look.rim > 0 && (
          // The light caught round the inside edge.
          <g filter={`url(#${id}-blur)`} opacity={look.rim}>
            {pane({ fill: 'none', strokeWidth: 2.6, style: { stroke: light } })}
          </g>
        )}
        {look.highlight > 0 && (
          <ellipse cx={7.5} cy={7.5} rx={4.5} ry={2.4} fill="#fff" opacity={look.highlight} filter={`url(#${id}-blur)`} />
        )}
      </g>
      {pane({ fill: `url(#${id}-sheen)` })}
      {pane({ strokeWidth: 0.5, style: { stroke: `color-mix(in srgb, ${to} 55%, transparent)` } })}
      {pane({ stroke: `url(#${id}-edge)`, strokeWidth: 0.55, opacity: 0.85 })}
      {/* A faint shadow under the white, so the detail separates from the colour. */}
      {look.shadow && (
        <g opacity={0.45} filter={`url(#${id}-soft)`} transform="translate(0 .5)">
          {detail(`color-mix(in srgb, ${to} 75%, #000)`)}
        </g>
      )}
      {detail('#fff')}
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
  finish,
  className,
}: {
  /** null means the app itself. */
  module: ModuleId | null;
  /** How the pane is lit: solid colour (the default), or brighter with light glowing from inside. */
  finish?: MarkFinish;
  size?: keyof typeof SIZES;
  className?: string;
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
          finish === 'glint' || finish === 'glint-tint' ? (
            <GlintObject
              id={id}
              drawing={DRAWINGS[key.shape]}
              from={key.from}
              to={key.to}
              px={sizing.px}
              tint={finish === 'glint-tint'}
            />
          ) : finish === 'lens' || finish === 'lens-crisp' ? (
            <LensObject
              id={id}
              drawing={DRAWINGS[key.shape]}
              from={key.from}
              to={key.to}
              px={sizing.px}
              crisp={finish === 'lens-crisp'}
            />
          ) : (
            <GlassObject id={id} drawing={DRAWINGS[key.shape]} from={key.from} to={key.to} px={sizing.px} finish={finish} />
          )
        )}
      </svg>
    </span>
  );
}
