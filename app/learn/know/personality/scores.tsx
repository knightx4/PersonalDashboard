import { Meter } from '@/components/ui/meter';
import { formatDay } from '@/lib/goals/dates';
import {
  BIG_FIVE_FACTORS,
  FACTOR_WORDS,
  factorPercent,
  type BigFiveFactor,
  type BigFiveScores,
} from '@/lib/learn/personality/ipip';

/**
 * The five Big Five scores (plan #1632), each as a share of its range with
 * the words for the end it leans toward. The raw IPIP sum is kept beside it
 * for anyone comparing with another scoring of the same test.
 */

function leaning(factor: BigFiveFactor, percent: number): string {
  const words = FACTOR_WORDS[factor];
  if (percent >= 60) return `Leans high: ${words.high}.`;
  if (percent <= 40) return `Leans low: ${words.low}.`;
  return 'Near the middle, between the two ends.';
}

export function BigFiveScoreList({
  scores,
  takenAt,
}: {
  scores: BigFiveScores;
  /** `YYYY-MM-DD`. */
  takenAt: string;
}) {
  return (
    <section aria-labelledby="big-five-scores">
      <h2 id="big-five-scores" className="text-ui font-medium text-ink">
        Your Big Five
      </h2>
      <p className="mt-0.5 text-small text-ink-muted">Taken {formatDay(takenAt, true)}</p>
      <ul className="mt-4 space-y-5">
        {BIG_FIVE_FACTORS.map((factor) => {
          const sum = scores[factor];
          const percent = factorPercent(sum);
          const { name } = FACTOR_WORDS[factor];
          return (
            <li key={factor}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-body font-medium text-ink">{name}</span>
                <span className="text-body tabular-nums text-ink">
                  {percent}
                  <span className="text-small text-ink-muted"> / 100</span>
                </span>
              </div>
              <Meter
                className="mt-1.5"
                value={percent}
                max={100}
                height="md"
                minFraction={0.02}
                label={`${name}: ${percent} of 100`}
                title={`${sum} on the IPIP scale of 10 to 50`}
              />
              <p className="mt-1.5 text-small text-ink-muted">{leaning(factor, percent)}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
