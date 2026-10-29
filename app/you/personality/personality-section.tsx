import Link, { linkVariants } from '@/components/ui/link';
import { buttonVariants, PRESS_AREA } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { Meter } from '@/components/ui/meter';
import { CardSection } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/goals/dates';
import {
  BIG_FIVE_FACTORS,
  FACTOR_WORDS,
  factorPercent,
  type BigFiveFactor,
} from '@/lib/you/personality/ipip';
import {
  readCount,
  readStatus,
  type BigFiveResult,
  type ReadStatus,
  type TypedResult,
} from '@/lib/you/personality/model';
import { EnneagramChart } from './enneagram-chart';
import { ThemeList } from './theme-list';
import type { TraitThemes } from '@/lib/you/personality/trait-themes';
import { PersonalityReadPanel } from './personality-read';
import { Note } from '@/components/ui/note';

/**
 * Your personality results on You's Personality tab (plan #1634, moved from
 * Learn's Know page by #1991.2): one section per test (note 6502788f). The
 * Big Five's holds its five traits in words, the vault themes closest to
 * each, Dash's read against your notes (#1635) and earlier results folded
 * beneath. Each other test's holds the type you typed in with Dash's read of
 * it folded under, or, before you have one, a link to take the test.
 */

/** The clock, read outside the component because reading it during render is unstable. */
function clock(): number {
  return Date.now();
}

/** The test and the types typed in, a press away from the tab. */
export const PERSONALITY_HREF = '/you/personality/test';

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
            className={linkVariants()}
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

/**
 * The tests with a slot on the tab whether or not a result is kept (note
 * 6502788f), each with where to take it. A typed-in result goes in the slot
 * whose test it names; one from any other test gets a slot of its own after
 * these.
 */
export const TEST_SLOTS: readonly { name: string; kind: TypedResult['kind']; href: string; site: string }[] = [
  { name: 'Myers-Briggs', kind: 'mbti', href: 'https://www.16personalities.com/free-personality-test', site: '16Personalities' },
  { name: 'Enneagram', kind: 'enneagram', href: 'https://www.truity.com/test/enneagram-personality-test', site: 'Truity' },
  { name: 'CliftonStrengths', kind: 'other', href: 'https://www.gallup.com/cliftonstrengths/en/home.aspx', site: 'Gallup' },
  { name: 'DISC', kind: 'other', href: 'https://www.truity.com/test/disc-personality-test', site: 'Truity' },
];

type Slot = { name: string; href: string | null; site: string | null; results: TypedResult[] };

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Every slot in order: the fixed tests, then one per other test named in a typed result. */
export function testSlots(typed: readonly TypedResult[]): Slot[] {
  const slots: Slot[] = TEST_SLOTS.map((slot) => ({ name: slot.name, href: slot.href, site: slot.site, results: [] }));
  for (const result of typed) {
    const fixed = TEST_SLOTS.findIndex((slot) =>
      slot.kind === 'other' ? result.kind === 'other' && sameName(slot.name, result.testName) : slot.kind === result.kind,
    );
    const at = fixed >= 0 ? fixed : slots.findIndex((slot) => slot.href === null && sameName(slot.name, result.testName));
    if (at >= 0) slots[at].results.push(result);
    else slots.push({ name: result.testName, href: null, site: null, results: [result] });
  }
  return slots;
}

/**
 * One test's section: its name, where to take or add it, and what is kept
 * from it. Each folds by its heading, kept in this browser per test (note
 * aff71d76), so a long page of tests can be shut down to the ones in use.
 */
function TestSection({
  title,
  meta,
  action,
  children,
}: {
  title: string;
  meta?: string;
  action: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <CardSection
      title={title}
      meta={meta}
      action={action}
      padding="standard"
      fold={`you.personality.${title}`}
    >
      <div className="space-y-3">{children}</div>
    </CardSection>
  );
}

/** A typed-in result in its test's slot, with Dash's read of it folded under. */
function TypedSlot({ slot, now }: { slot: Slot; now: number }) {
  // In the empty slot's sentence the link is text; on its own line under a
  // result it is a press target, and takes the phone's 44px press area.
  const take = (alone: boolean) =>
    slot.href ? (
      <a href={slot.href} target="_blank" rel="noreferrer" className={cn(linkVariants(), alone && PRESS_AREA)}>
        Take it at {slot.site}
      </a>
    ) : null;
  return (
    <TestSection
      title={slot.name}
      meta={slot.results[0] ? `Taken ${formatDay(slot.results[0].takenAt, true)}` : undefined}
      action={
        <Link href={PERSONALITY_HREF} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
          {slot.results.length > 0 ? 'Change' : 'Add your result'}
        </Link>
      }
    >
      {slot.results.length === 0 ? (
        <p className="text-ui text-ink-muted">Not taken yet. {take(false)}</p>
      ) : (
        <>
          {slot.results.map((t) => {
            const status = readStatus(t, now);
            return (
              <div key={t.id} className="space-y-1">
                <p className="text-body font-medium text-ink">{t.typedValue}</p>
                {t.note ? <p className="text-small text-ink-muted">{t.note}</p> : null}
                {t.typeScores ? <EnneagramChart scores={t.typeScores} className="py-2" /> : null}
                {t.themes ? <ThemeList themes={t.themes} className="py-2" /> : null}
                <Disclosure title={`Dash on ${t.typedValue}`} meta={readMeta(t, status)}>
                  <PersonalityReadPanel
                    resultId={t.id}
                    read={t.read}
                    status={status}
                    title={`Dash’s read of ${t.typedValue}`}
                  />
                </Disclosure>
              </div>
            );
          })}
          {slot.href && <p className="text-small text-ink-muted">{take(true)}</p>}
        </>
      )}
    </TestSection>
  );
}

function shortLine(result: BigFiveResult): string {
  return BIG_FIVE_FACTORS.map(
    (f) => `${FACTOR_WORDS[f].name} ${factorPercent(result.scores[f])}`,
  ).join(' · ');
}

/**
 * The Big Five and every other test as sections side by side, at one level
 * (note 6502788f): the Big Five is taken here and the rest are typed in, but
 * each is one test among several.
 */
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
    <div id="personality" className="max-w-2xl space-y-4">
      <TestSection
        title="Big Five"
        meta={latest ? `Taken ${formatDay(latest.takenAt, true)}` : undefined}
        action={
          <Link href={PERSONALITY_HREF} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            {latest ? 'Retake' : 'Take it here'}
          </Link>
        }
      >
        {!latest ? (
          <p className="text-ui text-ink-muted">
            Not taken yet. Fifty questions, and your five traits show beside the themes in your
            notes.
          </p>
        ) : (
          <>
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

            {/* Dash's read on its own panel inside the card, so its words
                stand apart from the scores and the note titles (plan #1764). */}
            <Note>
              <PersonalityReadPanel
                resultId={latest.id}
                read={latest.read}
                status={readStatus(latest, at)}
              />
            </Note>

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
          </>
        )}
      </TestSection>

      {testSlots(typed).map((slot) => (
        <TypedSlot key={slot.name} slot={slot} now={at} />
      ))}
    </div>
  );
}
