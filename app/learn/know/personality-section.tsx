import Link from 'next/link';
import { buttonVariants } from '@/components/ui/button';
import { Disclosure, SectionFold } from '@/components/ui/disclosure';
import { Meter } from '@/components/ui/meter';
import { formatDay } from '@/lib/goals/dates';
import {
  BIG_FIVE_FACTORS,
  FACTOR_WORDS,
  factorPercent,
  type BigFiveFactor,
} from '@/lib/learn/personality/ipip';
import type { BigFiveResult, TypedResult } from '@/lib/learn/personality/model';
import type { TraitThemes } from '@/lib/learn/personality/trait-themes';

/**
 * Your personality result on the Know page (plan #1634): the latest Big Five
 * as five traits in words, the vault themes closest to each, the types you
 * typed in from other tests, and earlier results folded beneath. With no Big
 * Five yet, one line offering the test.
 *
 * Dash's read of the result against your notes (#1635) goes under the traits.
 */

export const PERSONALITY_HREF = '/learn/know/personality';

function leaning(factor: BigFiveFactor, percent: number): string {
  const words = FACTOR_WORDS[factor];
  if (percent >= 60) return `Leans high: ${words.high}.`;
  if (percent <= 40) return `Leans low: ${words.low}.`;
  return 'Near the middle.';
}

function ThemeLinks({ themes }: { themes: TraitThemes[BigFiveFactor] }) {
  if (themes.length === 0) {
    return <p className="mt-1 text-small text-ink-muted">No theme in your notes sits near it.</p>;
  }
  return (
    <p className="mt-1 text-small text-ink-muted">
      Near it in your notes:{' '}
      {themes.map((theme, i) => (
        <span key={theme.id}>
          {i > 0 && ', '}
          <Link
            href={`/vault/map/${theme.id}`}
            className="text-ink underline decoration-border underline-offset-2 hover:decoration-ink"
          >
            {theme.name}
          </Link>
        </span>
      ))}
    </p>
  );
}

function shortLine(result: BigFiveResult): string {
  return BIG_FIVE_FACTORS.map(
    (f) => `${FACTOR_WORDS[f].name} ${factorPercent(result.scores[f])}`,
  ).join(' · ');
}

export function PersonalitySection({
  latest,
  earlier,
  typed,
  themes,
}: {
  latest: BigFiveResult | null;
  /** Older Big Five results, newest first. */
  earlier: BigFiveResult[];
  typed: TypedResult[];
  /** Null when the themes could not be matched. */
  themes: TraitThemes | null;
}) {
  return (
    <div id="personality" className="mt-8 scroll-mt-6">
      <SectionFold
        title="Personality"
        hint={latest ? `Big Five, taken ${formatDay(latest.takenAt, true)}` : undefined}
      >
        {!latest ? (
          <p className="text-ui text-ink-muted">
            <Link
              href={PERSONALITY_HREF}
              className="text-ink underline decoration-border underline-offset-2 hover:decoration-ink"
            >
              Take the personality test
            </Link>{' '}
            to see your five traits beside the themes in your notes.
          </p>
        ) : (
          <div className="max-w-2xl space-y-4">
            <ul className="space-y-4">
              {BIG_FIVE_FACTORS.map((factor) => {
                const percent = factorPercent(latest.scores[factor]);
                const { name } = FACTOR_WORDS[factor];
                return (
                  <li key={factor}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-body font-medium text-ink">{name}</span>
                      <span className="text-ui tabular-nums text-ink-muted">{percent} / 100</span>
                    </div>
                    <Meter
                      className="mt-1"
                      value={percent}
                      max={100}
                      minFraction={0.02}
                      label={`${name}: ${percent} of 100`}
                    />
                    <p className="mt-1 text-small text-ink-muted">{leaning(factor, percent)}</p>
                    {themes && <ThemeLinks themes={themes[factor]} />}
                  </li>
                );
              })}
            </ul>

            {!themes && (
              <p className="text-small text-ink-muted">
                The themes in your notes could not be matched to the traits just now.
              </p>
            )}

            {typed.length > 0 && (
              <p className="text-ui text-ink-muted">
                From other tests:{' '}
                {typed.map((t, i) => (
                  <span key={t.id}>
                    {i > 0 && ' · '}
                    <span className="text-ink">{t.typedValue}</span> on {t.testName}
                  </span>
                ))}
              </p>
            )}

            <Link href={PERSONALITY_HREF} className={buttonVariants({ variant: 'secondary' })}>
              Retake or add a type
            </Link>

            {earlier.length > 0 && (
              <Disclosure title="Earlier results" meta={`${earlier.length}`}>
                <ul className="space-y-2">
                  {earlier.map((result) => (
                    <li key={result.id} className="text-small text-ink-muted">
                      <span className="text-ink">{formatDay(result.takenAt, true)}</span>:{' '}
                      {shortLine(result)}
                    </li>
                  ))}
                </ul>
              </Disclosure>
            )}
          </div>
        )}
      </SectionFold>
    </div>
  );
}
