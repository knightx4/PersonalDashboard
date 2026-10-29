import { cn } from '@/lib/cn';
import {
  ENNEAGRAM_NAMES,
  ENNEAGRAM_TYPES,
  enneagramRanking,
} from '@/lib/you/personality/model';

/**
 * An Enneagram result with the score for every type: nine wedges round the
 * circle, 9 at the top and the rest clockwise as on the Enneagram symbol,
 * each wedge's area in proportion to its score, so the runner-up types show
 * how near they came to the top one. The top type is in the accent and the
 * rest in a paler step of it. Beside it, every type with its score, highest
 * first, so no reading rests on the shape alone.
 */

const R = 100;
const LABEL_R = R + 14;
/** Each of the nine wedges takes a ninth of the circle. */
const SLICE = (2 * Math.PI) / 9;
/** The 2px surface gap between wedges, as a half-angle at the rim. */
const GAP = 0.012;

function point(angle: number, radius: number): string {
  // Angle 0 is straight up, increasing clockwise.
  return `${(Math.sin(angle) * radius).toFixed(2)} ${(-Math.cos(angle) * radius).toFixed(2)}`;
}

/** The centre angle of a type's wedge: 9 at the top, 1 to 8 clockwise after it. */
function centre(type: number): number {
  return (type % ENNEAGRAM_TYPES.length) * SLICE;
}

function wedge(type: number, score: number): string | null {
  const radius = R * Math.sqrt(score / 100);
  if (radius < 1) return null;
  const from = centre(type) - SLICE / 2 + GAP;
  const to = centre(type) + SLICE / 2 - GAP;
  return `M 0 0 L ${point(from, radius)} A ${radius} ${radius} 0 0 1 ${point(to, radius)} Z`;
}

export function EnneagramChart({
  scores,
  className,
}: {
  /** Types 1 to 9 in order, each 0 to 100. */
  scores: readonly number[];
  className?: string;
}) {
  const ranking = enneagramRanking(scores);
  const top = ranking[0].type;
  return (
    <div className={cn('flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6', className)}>
      <svg
        viewBox={`${-LABEL_R - 10} ${-LABEL_R - 10} ${2 * (LABEL_R + 10)} ${2 * (LABEL_R + 10)}`}
        className="mx-auto w-full max-w-60 shrink-0 sm:mx-0"
        role="img"
        aria-label={`Enneagram scores: ${ranking.map((r) => `type ${r.type} ${r.score}`).join(', ')}`}
      >
        <circle r={R} className="fill-none stroke-border" strokeDasharray="2 3" />
        {ENNEAGRAM_TYPES.map((type) => {
          const score = scores[type - 1];
          const d = wedge(type, score);
          const [x, y] = point(centre(type), LABEL_R).split(' ').map(Number);
          return (
            <g key={type}>
              {d ? (
                <path
                  d={d}
                  className={type === top ? 'fill-accent' : 'fill-accent/35'}
                >
                  <title>{`${type} ${ENNEAGRAM_NAMES[type]}: ${score} of 100`}</title>
                </path>
              ) : null}
              <text
                x={x}
                y={y}
                textAnchor="middle"
                dominantBaseline="central"
                className={cn(
                  'text-[13px] tabular-nums',
                  type === top ? 'fill-ink font-semibold' : 'fill-ink-muted',
                )}
              >
                {type}
              </text>
            </g>
          );
        })}
      </svg>
      <ol className="min-w-0 flex-1 space-y-1 sm:max-w-xs" aria-label="Every type, highest score first">
        {ranking.map((r) => (
          <li key={r.type} className="flex items-baseline justify-between gap-3 text-small">
            <span className={r.type === top ? 'font-medium text-ink' : 'text-ink-muted'}>
              {r.type} {ENNEAGRAM_NAMES[r.type]}
            </span>
            <span className={cn('tabular-nums', r.type === top ? 'text-ink' : 'text-ink-muted')}>
              {r.score}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
