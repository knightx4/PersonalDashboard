import { useId } from 'react';
import { cn } from '@/lib/cn';
import { HOME_MARK } from '@/lib/modules';
import { GROUND } from './module-mark';
import { MOTION_MS } from '@/lib/motion';

/**
 * Dash's own mark: a visor with two eyes, cut from the fat dash of the app
 * icon. It has five states, and working comes in five kinds.
 *
 * The visor is the app icon's dash grown tall enough to hold a pair of eyes,
 * which are cut out of it the way the module marks cut their one detail: the
 * tinted ground shows through, so the eyes are right in every theme without a
 * branch.
 *
 * It is drawn in currentColor, so it takes the colour of wherever it is placed:
 * faint in the margin of a thread, the danger colour beside an error. Where
 * Dash is the subject rather than a credit, `tone="brand"` paints it in the
 * app icon's own blue, violet and pink instead. That ramp is the home mark's,
 * and Dash is the one other thing allowed to wear it, being the app's own
 * assistant. Failed ignores it and keeps the colour of the error beside it.
 *
 * The racing theme comes from Speed Racer, and it only shows when something is
 * happening. At rest the visor stands level and calm beside text.
 *
 *   idle      the visor, level, blinking now and then.
 *   asleep    eyes shut and a small z drifting up from the corner. For a Dash
 *             that has to be woken, such as the tag button on a comment
 *             before it is pressed.
 *   working   the visor leans forward with speed lines streaming off the back
 *             and a slight rattle. Indeterminate: nothing fills, because a run
 *             does not report how far it has got.
 *   done      the visor stands back up with happy eyes, under a chequered flag
 *             that waves on a pole above its corner, with one flash as it
 *             settles.
 *   failed    the same pole with a plain flag hanging limp, and the visor
 *             hollow with flat eyes. Nothing moves.
 *
 * Working can say what kind of work it is, when the caller knows:
 *
 *   reading    level, eyes lowered and jumping along a line, over two lines of
 *              text.
 *   searching  level, eyes sweeping wide while a ring pings out from the visor.
 *   writing    level, eyes lowered to a line being drawn out under the visor
 *              towards a blinking caret.
 *   thinking   level, eyes glancing up to one corner, then the other.
 *
 * Every state and every kind has its own still shape, so a single frame says
 * which it is and the mark still reads under reduced motion, when nothing
 * moves. The motion is the dash-mark-* utilities in app/globals.css, all of
 * them switched off in the reduced-motion block.
 */

export type DashState = 'idle' | 'asleep' | 'working' | 'done' | 'failed';

export const DASH_STATES: readonly DashState[] = ['idle', 'asleep', 'working', 'done', 'failed'];

/** What kind of work a working mark shows. Without one it leans and races. */
export type DashActivity = 'reading' | 'searching' | 'writing' | 'thinking';

export const DASH_ACTIVITIES: readonly DashActivity[] = ['reading', 'searching', 'writing', 'thinking'];

/** currentColor takes the colour of the place; brand wears the app icon's ramp. */
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

/** The visor: the icon's dash, tall enough for eyes. */
const VISOR = { x: 2.2, y: 7.6, width: 19.6, height: 8.8 } as const;
/** The eyes' left edges; both are 2.4 wide and 4.4 tall, from y 9.8. */
const EYES = [7.6, 14] as const;
/** The leaning visor while working, a little shorter so the lines fit behind. */
const LEANING = { x: 5.6, y: 7.8, width: 16.4, height: 8.4 } as const;
const LEANING_EYES = [9.6, 15.6] as const;
/** Done and failed sit lower, to leave room for the flag above. */
const FLAG_DROP = 2.2;
/** The flag pole's x, and the chequered flag's cell. */
const POLE = 15.6;
const CHECK = 1.4;
const STROKE = 1.4;

/** Every part of the glyph is drawn in this: currentColor, or the brand ramp. */
type Paint = { paint: string };

function Pill({
  x,
  y,
  width,
  height,
  ...rest
}: { x: number; y: number; width: number; height: number } & React.SVGProps<SVGRectElement>) {
  return <rect x={x} y={y} width={width} height={height} rx={height / 2} {...rest} />;
}

/** The visor outline, for failed: the outer edge stays where the solid one is. */
function HollowVisor({ paint }: Paint) {
  const inset = STROKE / 2;
  return (
    <Pill
      x={VISOR.x + inset}
      y={VISOR.y + inset}
      width={VISOR.width - STROKE}
      height={VISOR.height - STROKE}
      fill="none"
      stroke={paint}
      strokeWidth={STROKE}
    />
  );
}

/** The visor with whatever is drawn in `cuts` cut out of it (black cuts, white keeps). */
function CutVisor({
  id,
  paint,
  cuts,
  box = VISOR,
  className,
}: Paint & {
  id: string;
  cuts: React.ReactNode;
  box?: typeof VISOR | typeof LEANING;
  className?: string;
}) {
  return (
    <>
      <mask id={id} maskUnits="userSpaceOnUse" x={0} y={0} width={24} height={24}>
        <rect width={24} height={24} fill="#fff" />
        {cuts}
      </mask>
      <Pill {...box} className={className} fill={paint} mask={`url(#${id})`} />
    </>
  );
}

function Eyes({
  x = EYES,
  y = 9.8,
  className,
  transform,
}: {
  x?: readonly number[];
  y?: number;
  className?: string;
  /** Where the eyes rest when their motion is off. */
  transform?: string;
}) {
  return (
    <g className={className} transform={transform}>
      {x.map((ex) => (
        <rect key={ex} x={ex} y={y} width={2.4} height={4.4} rx={1.2} fill="#000" />
      ))}
    </g>
  );
}

/** Two upturned arcs: the happy eyes of done. */
const HAPPY = 'M7.4 13.3Q8.8 10.4 10.2 13.3M13.8 13.3Q15.2 10.4 16.6 13.3';
/** Two downturned arcs: eyes shut in sleep. */
const SHUT = 'M7.4 11.8Q8.8 13.8 10.2 11.8M13.8 11.8Q15.2 13.8 16.6 11.8';

function ChequeredFlag({ paint }: Paint) {
  const cells: React.ReactNode[] = [];
  for (let col = 0; col < 5; col += 1) {
    for (let row = 0; row < 3; row += 1) {
      if ((col + row) % 2 === 0) {
        cells.push(
          <rect
            key={`${col}-${row}`}
            x={POLE + col * CHECK}
            y={1.6 + row * CHECK}
            width={CHECK}
            height={CHECK}
            fill={paint}
          />,
        );
      }
    }
  }
  return (
    <g className="dash-mark-wave">
      {cells}
      <rect x={POLE} y={1.6} width={CHECK * 5} height={CHECK * 3} fill="none" stroke={paint} strokeWidth={0.5} />
    </g>
  );
}

const Pole = ({ paint }: Paint) => (
  <path d={`M${POLE} ${VISOR.y + FLAG_DROP}V1.6`} stroke={paint} strokeWidth={1} strokeLinecap="round" />
);

function Working({ id, paint, activity }: Paint & { id: string; activity?: DashActivity }) {
  switch (activity) {
    case 'reading':
      return (
        <>
          <CutVisor id={id} paint={paint} cuts={<Eyes y={10.6} className="dash-mark-read" />} />
          <path d="M6 19H18M6 21.4H13" stroke={paint} strokeWidth={1.2} strokeLinecap="round" opacity={0.5} />
        </>
      );

    case 'searching':
      return (
        <>
          <circle className="dash-mark-ping" cx={12} cy={12} r={7} stroke={paint} strokeWidth={1} opacity={0.45} />
          <CutVisor id={id} paint={paint} cuts={<Eyes className="dash-mark-sweep" />} />
        </>
      );

    case 'writing':
      return (
        <>
          <CutVisor id={id} paint={paint} cuts={<Eyes y={10.6} />} />
          <Pill className="dash-mark-write" x={5} y={18.6} width={12} height={1.6} fill={paint} />
          <rect className="dash-mark-caret" x={18.2} y={17.4} width={1.2} height={4} rx={0.4} fill={paint} />
        </>
      );

    case 'thinking':
      // At rest the eyes look up into the corner, so a still frame is not idle.
      return (
        <CutVisor
          id={id}
          paint={paint}
          cuts={<Eyes className="dash-mark-ponder" transform="translate(1.8 -1.5)" />}
        />
      );

    default:
      return (
        <>
          {[
            { x: 0.8, y: 9.2, width: 3.8, opacity: 0.55 },
            { x: 0, y: 12, width: 4.4, opacity: 1 },
            { x: 0.8, y: 14.8, width: 3.8, opacity: 0.55 },
          ].map((line, index) => (
            <Pill
              key={line.y}
              className="dash-mark-streak"
              style={{ animationDelay: `${index * MOTION_MS.quick}ms` }}
              x={line.x}
              y={line.y - 0.7}
              width={line.width}
              height={1.4}
              fill={paint}
              opacity={line.opacity}
            />
          ))}
          <g className="dash-mark-rattle">
            <g transform="translate(12 12) skewX(-14) translate(-12 -12)">
              <CutVisor id={id} paint={paint} box={LEANING} cuts={<Eyes x={LEANING_EYES} y={10} />} />
            </g>
          </g>
        </>
      );
  }
}

function Glyph({
  state,
  activity,
  id,
  paint,
}: Paint & { state: DashState; activity?: DashActivity; id: string }) {
  switch (state) {
    case 'working':
      return <Working id={id} paint={paint} activity={activity} />;

    case 'asleep':
      return (
        <>
          <CutVisor
            id={id}
            paint={paint}
            className="dash-mark-breathe"
            cuts={<path d={SHUT} fill="none" stroke="#000" strokeWidth={1.6} strokeLinecap="round" />}
          />
          <path
            className="dash-mark-snooze"
            d="M17.6 2.4H20.6L17.6 5.6H20.6"
            stroke={paint}
            strokeWidth={1.1}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );

    case 'done':
      return (
        <g className="dash-mark-flash">
          <g transform={`translate(0 ${FLAG_DROP})`}>
            <CutVisor
              id={id}
              paint={paint}
              cuts={<path d={HAPPY} fill="none" stroke="#000" strokeWidth={1.8} strokeLinecap="round" />}
            />
          </g>
          <Pole paint={paint} />
          <ChequeredFlag paint={paint} />
        </g>
      );

    case 'failed':
      return (
        <>
          <g transform={`translate(0 ${FLAG_DROP})`}>
            <HollowVisor paint={paint} />
            <path
              d="M7.6 12.4H10.2M13.8 12.4H16.4"
              stroke={paint}
              strokeWidth={1.7}
              strokeLinecap="round"
              opacity={0.7}
            />
          </g>
          <Pole paint={paint} />
          {/* A plain flag, hanging limp. */}
          <path
            d={`M${POLE} 1.8Q17.6 2.6 17 4.6Q16.6 6.2 17.4 7.6L${POLE} 7.2Z`}
            stroke={paint}
            strokeWidth={1}
            strokeLinejoin="round"
            opacity={0.75}
          />
        </>
      );

    case 'idle':
    default:
      return <CutVisor id={id} paint={paint} cuts={<Eyes className="dash-mark-blink" />} />;
  }
}

export function DashMark({
  state = 'idle',
  activity,
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
   * The brand ramp, for where Dash is the subject: the Ask Dash button, a
   * reply on its way. Left out, the mark takes the colour of its place.
   * Failed always does.
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
  const brand = tone === 'brand' && state !== 'failed';
  const ramp = HOME_MARK.key;
  const paint = brand ? `url(#${id}-ramp)` : 'currentColor';

  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center', sizing.box, className)}
      data-dash-state={state}
      {...(kind ? { 'data-dash-activity': kind } : {})}
      {...(brand ? { 'data-dash-tone': 'brand' } : {})}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
    >
      <svg width={sizing.px} height={sizing.px} viewBox="0 0 24 24" fill="none" aria-hidden>
        {brand && (
          <defs>
            {/* Across the visor and slightly down it, as on the app icon. */}
            <linearGradient id={`${id}-ramp`} gradientUnits="userSpaceOnUse" x1={3} y1={18} x2={21} y2={6}>
              <stop offset={0} stopColor={ramp.from} />
              <stop offset={0.5} stopColor={ramp.mid} />
              <stop offset={1} stopColor={ramp.to} />
            </linearGradient>
          </defs>
        )}
        <path
          d={GROUND}
          fill={brand ? ramp.from : 'currentColor'}
          fillOpacity={brand ? 0.16 : 0.12}
        />
        <Glyph state={state} activity={kind} id={id} paint={paint} />
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
