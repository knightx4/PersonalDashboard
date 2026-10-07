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
import {
  readCount,
  readStatus,
  type BigFiveResult,
  type ReadStatus,
  type TypedResult,
} from '@/lib/learn/personality/model';
import type { TraitThemes } from '@/lib/learn/personality/trait-themes';
import { PersonalityReadPanel } from './personality-read';

/**
 * Your personality result on the Know page (plan #1634): the latest Big Five
 * as five traits in words, the vault themes closest to each, the types you
 * typed in from other tests, and earlier results folded beneath. With no Big
 * Five yet, one line offering the test.
 *
 * Dash's read of the result against your notes (#1635) goes under the traits,
 * and the read of each typed-in type folds beneath the line that lists them.
 */

/** The clock, read outside the component because reading it during render is unstable. */
function clock(): number {
  return Date.now();
}

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

const FOLD_META: Record<ReadStatus, string> = {
  ready: '',
  pending: 'reading',
  failed: 'did not run',
  none: 'not read yet',
};

function readMeta(result: TypedResult, status: ReadStatus): string {
  if (status !== 'ready' || !result.read) return FOLD_META[status];
  return readCount(result.read.points) || 'nothing to compare';
}

/** The types typed in from other tests, and Dash's read of each folded under. */
function OtherTests({ typed, now }: { typed: TypedResult[]; now: number }) {
  if (typed.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-ui text-ink-muted">
        From other tests:{' '}
        {typed.map((t, i) => (
          <span key={t.id}>
            {i > 0 && ' · '}
            <span className="text-ink">{t.typedValue}</span> on {t.testName}
          </span>
        ))}
      </p>
      {typed.map((t) => {
        const status = readStatus(t, now);
        return (
          <Disclosure key={t.id} title={`Dash on ${t.typedValue}`} meta={readMeta(t, status)}>
            <PersonalityReadPanel
              resultId={t.id}
              read={t.read}
              status={status}
              title={`Dash’s read of ${t.typedValue}`}
            />
          </Disclosure>
        );
      })}
    </div>
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
  now,
}: {
  latest: BigFiveResult | null;
  /** Older Big Five results, newest first. */
  earlier: BigFiveResult[];
  typed: TypedResult[];
  /** Null when the themes could not be matched. */
  themes: TraitThemes | null;
  /**
   * The time the page is drawn, which says whether a read is still coming.
   * The gallery passes a fixed one; the page leaves it to the clock.
   */
  now?: number;
}) {
  const at = now ?? clock();
  return (
    <div id="personality" className="mt-8 scroll-mt-6">
      <SectionFold
        title="Personality"
        hint={latest ? `Big Five, taken ${formatDay(latest.takenAt, true)}` : undefined}
      >
        {!latest ? (
          <div className="max-w-2xl space-y-4">
            <p className="text-ui text-ink-muted">
              <Link
                href={PERSONALITY_HREF}
                className="text-ink underline decoration-border underline-offset-2 hover:decoration-ink"
              >
                Take the personality test
              </Link>{' '}
              to see your five traits beside the themes in your notes.
            </p>
            <OtherTests typed={typed} now={at} />
          </div>
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

            <PersonalityReadPanel
              resultId={latest.id}
              read={latest.read}
              status={readStatus(latest, at)}
            />

            <OtherTests typed={typed} now={at} />

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
