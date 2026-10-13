import { useId } from 'react';
import { cn } from '@/lib/cn';
import { HOME_MARK } from '@/lib/modules';
import { MOTION_MS } from '@/lib/motion';

/**
 * Dash's own mark: a glass visor with a glowing core behind it and two eyes on
 * the glass. It has five states, and working comes in four kinds.
 *
 * The core is what changes. It is drawn twice: once blurred and unclipped, so
 * a little light spills round the visor, and once blurred inside the visor,
 * where the glass softens it. The pane over it is frosted white on dark
 * themes; on light ones it also carries a tint of the core's colour and a
 * coloured edge, so the visor has an outline on white. That switch is made by
 * CSS light-dark() from the color-scheme of wherever the mark sits, so one
 * drawing serves every theme and the sheets inside Lightbox without a branch
 * here.
 *
 * Idle is the default, and every state moves:
 *
 *   idle      level; the core breathes and the eyes glance round and blink.
 *   asleep    eyes shut and the core down to an ember, with a z drifting up.
 *             For a Dash that has to be woken, such as the tag button on a
 *             comment before it is pressed.
 *   working   the visor leans forward with speed lines streaming off the back
 *             and the core pulsing. Indeterminate: nothing fills, because a
 *             run does not report how far it has got.
 *   done      the core turns green and the eyes smile; it bobs gently.
 *   failed    no core at all, just clear glass and flat eyes, flickering now
 *             and then like a light that has gone.
 *
 * Working can say what kind of work it is, when the caller knows:
 *
 *   reading    eyes lowered and jumping along two lines of text below.
 *   searching  eyes sweeping wide while a ring pings out from the visor.
 *   writing    eyes lowered to a line being drawn out towards a caret.
 *   thinking   eyes glancing up to one corner, then the other.
 *
 * Every state and kind has its own still shape, so a single frame says which
 * it is and the mark still reads under reduced motion. The motion is the
 * dash-mark-* utilities in app/globals.css, all switched off in the
 * reduced-motion block.
 *
 * The capsule visor is Dash's alone. The four runners on the runner card each
 * have their own visor shape and their own colour (`runner`), so they can be
 * told apart at a glance and never mistaken for Dash itself.
 *
 * Without `tone="brand"` or a runner, the core is drawn in currentColor, so the
 * mark takes the colour of its place: faint in the margin of a thread, the
 * danger colour beside an error.
 */

export type DashState = 'idle' | 'asleep' | 'working' | 'done' | 'failed';

export const DASH_STATES: readonly DashState[] = ['idle', 'asleep', 'working', 'done', 'failed'];

/** What kind of work a working mark shows. Without one it leans and races. */
export type DashActivity = 'reading' | 'searching' | 'writing' | 'thinking';

export const DASH_ACTIVITIES: readonly DashActivity[] = ['reading', 'searching', 'writing', 'thinking'];

/** One of the runner card's four slots, each with its own visor and colour. */
export type DashRunner = 'feature-1' | 'feature-2' | 'feature-3' | 'goals';

export const DASH_RUNNERS: readonly DashRunner[] = ['feature-1', 'feature-2', 'feature-3', 'goals'];

type Visor = 'capsule' | 'square' | 'orb' | 'shield' | 'hexagon';

/** Each runner's visor and the three stops of its core, light to deep. */
const RUNNERS: Record<DashRunner, { visor: Visor; core: readonly [string, string, string] }> = {
  'feature-1': { visor: 'square', core: ['#8aa2ff', '#4f6dff', '#3550e0'] },
  'feature-2': { visor: 'orb', core: ['#c09bff', '#8b5cf6', '#6d28d9'] },
  'feature-3': { visor: 'shield', core: ['#ffa3c4', '#ff5f99', '#db2777'] },
  goals: { visor: 'hexagon', core: ['#7ff0c0', '#22c58b', '#05734e'] },
};

/** Each runner's visor, as a sentence would name it. */
export const DASH_RUNNER_VISORS: Record<DashRunner, string> = {
  'feature-1': 'rounded square',
  'feature-2': 'orb',
  'feature-3': 'shield',
  goals: 'hexagon',
};

/** currentColor takes the colour of the place; brand wears the app's ramp. */
export type DashTone = 'current' | 'brand';

/** What a screen reader hears for each state when no label is passed. */
export const DASH_STATE_LABELS: Record<DashState, string> = {
  idle: 'Dash',
  asleep: 'Dash is asleep',
  working: 'Dash is working',
  done: 'Dash has finished',
  failed: 'Dash could not finish',
};

/** What a screen reader hears for a working mark that says what it is doing. */
export const DASH_ACTIVITY_LABELS: Record<DashActivity, string> = {
  reading: 'Dash is reading',
  searching: 'Dash is searching',
  writing: 'Dash is writing',
  thinking: 'Dash is thinking',
};

/**
 * The first two match the Lucide icons the mark replaced (size-3.5 and
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

/* ---------------------------------------------------------------------------
 * The glass. Shared with ModuleMark, so the marks and Dash are one material.
 * ------------------------------------------------------------------------- */

/** Frosted white over the core: stronger on a light page, where it has to read. */
export const GLASS_SHEEN_TOP = 'light-dark(rgb(255 255 255 / 0.55), rgb(255 255 255 / 0.28))';
export const GLASS_SHEEN_BOTTOM = 'light-dark(rgb(255 255 255 / 0.22), rgb(255 255 255 / 0.06))';

/** On a light page only: a tint of the colour behind the glass. */
export const glassTint = (colour: string, amount = 24) =>
  `light-dark(color-mix(in srgb, ${colour} ${amount}%, transparent), transparent)`;

/** On a light page only: an edge in that colour, so the pane has an outline on white. */
export const glassOutline = (colour: string) =>
  `light-dark(color-mix(in srgb, ${colour} 50%, transparent), transparent)`;

/** The lit edge every pane has: bright along the top, dimmer down the sides. */
export function GlassEdgeStops() {
  return (
    <>
      <stop offset="0" stopColor="#fff" stopOpacity={0.95} />
      <stop offset="0.5" stopColor="#fff" stopOpacity={0.2} />
      <stop offset="1" stopColor="#fff" stopOpacity={0.6} />
    </>
  );
}

export function GlassSheenStops() {
  return (
    <>
      <stop offset="0" style={{ stopColor: GLASS_SHEEN_TOP }} />
      <stop offset="1" style={{ stopColor: GLASS_SHEEN_BOTTOM }} />
    </>
  );
}

/* ---------------------------------------------------------------------------
 * Visors, centred on (12, cy).
 * ------------------------------------------------------------------------- */

function hexagon(cx: number, cy: number, r: number): string {
  const points = Array.from({ length: 6 }, (_, i) => {
    const t = Math.PI / 6 + (i * Math.PI) / 3;
    return [cx + Math.cos(t) * r, cy + Math.sin(t) * r];
  });
  // Rounded corners: cut each one back a little and curve through the vertex.
  const k = 0.22;
  let d = '';
  points.forEach((p1, j) => {
    const p0 = points[(j + 5) % 6];
    const p2 = points[(j + 1) % 6];
    const a = [p1[0] + (p0[0] - p1[0]) * k, p1[1] + (p0[1] - p1[1]) * k];
    const b = [p1[0] + (p2[0] - p1[0]) * k, p1[1] + (p2[1] - p1[1]) * k];
    d += `${j ? 'L' : 'M'}${a[0].toFixed(2)} ${a[1].toFixed(2)}Q${p1[0].toFixed(2)} ${p1[1].toFixed(2)} ${b[0].toFixed(2)} ${b[1].toFixed(2)}`;
  });
  return `${d}Z`;
}

function visorPath(visor: Visor, cy: number): string {
  switch (visor) {
    case 'square':
      return `M8.4 ${cy - 5.4}h7.2a3.8 3.8 0 0 1 3.8 3.8v3.2a3.8 3.8 0 0 1-3.8 3.8H8.4a3.8 3.8 0 0 1-3.8-3.8v-3.2a3.8 3.8 0 0 1 3.8-3.8Z`;
    case 'orb':
      return `M12 ${cy - 6.2}a6.2 6.2 0 1 1 0 12.4a6.2 6.2 0 0 1 0-12.4Z`;
    case 'shield':
      return `M7.6 ${cy - 5.4}h8.8a2.2 2.2 0 0 1 2.18 2.5l-.5 3.6a4.4 4.4 0 0 1-2.4 3.3l-2.48 1.24a2.6 2.6 0 0 1-2.4 0L8.32 ${cy + 3.9}a4.4 4.4 0 0 1-2.4-3.3l-.5-3.6A2.2 2.2 0 0 1 7.6 ${cy - 5.4}Z`;
    case 'hexagon':
      return hexagon(12, cy, 6.6);
    case 'capsule':
    default:
      return `M7.6 ${cy - 4.4}h8.8a4.4 4.4 0 0 1 0 8.8h-8.8a4.4 4.4 0 0 1 0-8.8Z`;
  }
}

/* ---------------------------------------------------------------------------
 * The glyph, without its <svg>, so ModuleMark can draw it on the home plate.
 * ------------------------------------------------------------------------- */

const GREEN = ['#4ade80', '#22c55e', '#16a34a'] as const;

/** Leaning forward, about the centre: the working pose and the app icon's. */
const LEAN = 'translate(12 12) skewX(-11) translate(-12 -12) translate(1.2 0)';

export function DashGlyph({
  id,
  state,
  activity,
  tone = 'current',
  runner,
}: {
  /** Unique per mark: names its gradients, filter and clip. */
  id: string;
  state: DashState;
  activity?: DashActivity;
  tone?: DashTone;
  runner?: DashRunner;
}) {
  const visor: Visor = runner ? RUNNERS[runner].visor : 'capsule';
  const ramp: readonly string[] = runner
    ? RUNNERS[runner].core
    : [HOME_MARK.key.from, HOME_MARK.key.mid, HOME_MARK.key.to];
  const coloured = Boolean(runner) || tone === 'brand';
  const failed = state === 'failed';
  const stops = state === 'done' && coloured ? GREEN : ramp;
  // currentColor wherever the mark takes the colour of its place.
  const paint = coloured ? `url(#${id}-core)` : 'currentColor';
  const solid = coloured ? stops[1] : 'currentColor';

  const kind = state === 'working' ? activity : undefined;
  const lean = state === 'working' && !kind;
  // Reading and writing raise the visor to leave room for the line below it.
  const cy = kind === 'reading' || kind === 'writing' ? 10 : 12;
  const d = visorPath(visor, cy);
  const ey = visor === 'shield' ? cy - 0.6 : cy;

  const coreMotion = lean
    ? 'dash-mark-pulse'
    : state === 'asleep'
      ? 'dash-mark-ember'
      : failed
        ? undefined
        : 'dash-mark-glow';
  const coreStrength = state === 'asleep' ? 0.35 : 1;
  const core =
    visor === 'capsule' ? (
      <rect x={6.4} y={cy - 2.8} width={11.2} height={5.6} rx={2.8} fill={paint} />
    ) : (
      <path d={d} fill={paint} transform={`translate(12 ${cy}) scale(.62) translate(-12 -${cy})`} />
    );

  const eyeColour = failed ? 'currentColor' : '#fff';
  const eyeX = lean ? [11.2, 14.6] : [9.4, 12.8];
  let eyes: React.ReactNode;
  if (state === 'asleep') {
    eyes = (
      <path
        d={`M9 ${ey - 0.2}q1.2 1.2 2.4 0M12.6 ${ey - 0.2}q1.2 1.2 2.4 0`}
        stroke={eyeColour}
        strokeWidth={1.2}
        strokeLinecap="round"
      />
    );
  } else if (state === 'done') {
    eyes = (
      <path
        d={`M9 ${ey + 0.7}q1.2-1.6 2.4 0M12.6 ${ey + 0.7}q1.2-1.6 2.4 0`}
        stroke={eyeColour}
        strokeWidth={1.3}
        strokeLinecap="round"
      />
    );
  } else if (failed) {
    eyes = (
      <path
        d={`M9.2 ${ey}h2M12.8 ${ey}h2`}
        stroke={eyeColour}
        strokeWidth={1.3}
        strokeLinecap="round"
        opacity={0.75}
      />
    );
  } else {
    // Where the eyes rest, and what moves them.
    const look =
      kind === 'reading'
        ? { className: 'dash-mark-read', dy: 0.8 }
        : kind === 'writing'
          ? { className: undefined, dy: 0.8 }
          : kind === 'searching'
            ? { className: 'dash-mark-sweep', dy: 0 }
            : kind === 'thinking'
              ? { className: 'dash-mark-ponder', dy: 0, transform: 'translate(1.4 -1.3)' }
              : lean
                ? { className: undefined, dy: 0 }
                : { className: 'dash-mark-glance', dy: 0 };
    eyes = (
      <g className={look.className} transform={'transform' in look ? look.transform : undefined}>
        <g className="dash-mark-blink" fill={eyeColour}>
          {eyeX.map((x) => (
            <rect key={x} x={x} y={ey - 2 + look.dy} width={1.9} height={4 - look.dy} rx={0.95} />
          ))}
        </g>
      </g>
    );
  }

  let body = (
    <>
      {!failed && (
        <g opacity={coreStrength * 0.85}>
          <g filter={`url(#${id}-blur)`} className={coreMotion}>
            {core}
          </g>
        </g>
      )}
      <path d={d} style={{ fill: failed ? 'transparent' : glassTint(solid) }} />
      {!failed && (
        <g clipPath={`url(#${id}-clip)`}>
          <g opacity={coreStrength}>
            <g filter={`url(#${id}-blur)`} className={coreMotion}>
              {core}
              {core}
            </g>
          </g>
        </g>
      )}
      <path d={d} fill={`url(#${id}-sheen)`} />
      <path
        d={d}
        strokeWidth={failed ? 1.1 : 0.8}
        style={{ stroke: failed ? 'currentColor' : glassOutline(solid) }}
        opacity={failed ? 0.6 : 1}
      />
      <path d={d} stroke={`url(#${id}-edge)`} strokeWidth={0.55} />
      {eyes}
    </>
  );

  if (lean) {
    body = (
      <g transform={LEAN}>
        {[
          { y: cy - 2.6, x: 0.6, width: 2.4, opacity: 0.55 },
          { y: cy, x: -0.2, width: 3.2, opacity: 1 },
          { y: cy + 2.6, x: 0.6, width: 2.4, opacity: 0.55 },
        ].map((line, index) => (
          <rect
            key={line.y}
            className="dash-mark-streak"
            style={{ animationDelay: `${index * MOTION_MS.quick}ms` }}
            x={line.x}
            y={line.y - 0.45}
            width={line.width}
            height={0.9}
            rx={0.45}
            fill={solid}
            opacity={line.opacity}
          />
        ))}
        {body}
      </g>
    );
  }
  if (state === 'done') body = <g className="dash-mark-bob">{body}</g>;
  if (failed) body = <g className="dash-mark-flicker">{body}</g>;

  return (
    <>
      <defs>
        {coloured && (
          <linearGradient id={`${id}-core`} gradientUnits="userSpaceOnUse" x1={5} y1={0} x2={19} y2={0}>
            {stops.map((colour, index) => (
              <stop key={index} offset={index / (stops.length - 1)} stopColor={colour} />
            ))}
          </linearGradient>
        )}
        <filter id={`${id}-blur`} filterUnits="userSpaceOnUse" x={-10} y={-10} width={44} height={44}>
          <feGaussianBlur stdDeviation={1.6} />
        </filter>
        <clipPath id={`${id}-clip`}>
          <path d={d} />
        </clipPath>
        <linearGradient id={`${id}-edge`} gradientUnits="userSpaceOnUse" x1={0} y1={cy - 6.5} x2={0} y2={cy + 6.5}>
          <GlassEdgeStops />
        </linearGradient>
        <linearGradient id={`${id}-sheen`} gradientUnits="userSpaceOnUse" x1={0} y1={cy - 6.5} x2={0} y2={cy + 6.5}>
          <GlassSheenStops />
        </linearGradient>
      </defs>
      {kind === 'searching' && (
        <circle className="dash-mark-ping" cx={12} cy={12} r={8.6} stroke={solid} strokeWidth={1} opacity={0.5} />
      )}
      {body}
      {kind === 'reading' && (
        <path d="M6.6 17.6H17.4M6.6 20H13" stroke={solid} strokeWidth={1.3} strokeLinecap="round" opacity={0.6} />
      )}
      {kind === 'writing' && (
        <>
          <rect className="dash-mark-write" x={6} y={17.4} width={10} height={1.6} rx={0.8} fill={solid} />
          <rect className="dash-mark-caret" x={16.8} y={16.2} width={1.3} height={4} rx={0.5} fill={solid} />
        </>
      )}
      {kind === 'thinking' && (
        <>
          <circle cx={18.8} cy={4.8} r={1} fill={solid} opacity={0.55} />
          <circle cx={20.6} cy={2.8} r={0.7} fill={solid} opacity={0.35} />
        </>
      )}
      {state === 'asleep' && (
        <path
          className="dash-mark-snooze"
          d="M18.6 2.8h2.4l-2.4 2.6h2.4"
          stroke={solid}
          strokeWidth={1}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </>
  );
}

export function DashMark({
  state = 'idle',
  activity,
  runner,
  tone = 'current',
  size = 'icon',
  label,
  decorative = false,
  className,
}: {
  state?: DashState;
  /** What kind of work, for a working mark. Ignored in every other state. */
  activity?: DashActivity;
  /**
   * One of the runner card's slots: its own visor shape and colour instead of
   * Dash's capsule. The colour holds in every state, so `tone` is ignored.
   */
  runner?: DashRunner;
  /**
   * The brand ramp, for where Dash is the subject: the Ask Dash button, a
   * reply on its way. Left out, the core takes the colour of its place.
   */
  tone?: DashTone;
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
  const id = `dash-mark-${useId().replace(/:/g, '')}`;
  const sizing = SIZES[size];
  const kind = state === 'working' ? activity : undefined;
  const name = label ?? (kind ? DASH_ACTIVITY_LABELS[kind] : DASH_STATE_LABELS[state]);
  const brand = !runner && tone === 'brand';

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', sizing.box, className)}
      data-dash-state={state}
      {...(kind ? { 'data-dash-activity': kind } : {})}
      {...(runner ? { 'data-dash-runner': runner } : {})}
      {...(brand ? { 'data-dash-tone': 'brand' } : {})}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
    >
      <svg width={sizing.px} height={sizing.px} viewBox="0 0 24 24" fill="none" overflow="visible" aria-hidden>
        <DashGlyph id={id} state={state} activity={kind} tone={tone} runner={runner} />
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
