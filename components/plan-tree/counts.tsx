import { Bands } from '@/components/ui/meter';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { TONE_TEXT, type DevTone } from '@/components/dev/state-label';
import { HEALTH, TONE_DOT } from '@/lib/plan/health-words';
import { PLAN_HEALTHS, type PlanBand, type PlanProgress, type PlanTally } from '@/lib/plan/tree';
import { PLAN_HEALTH_GLYPHS } from '@/lib/status-glyphs';
import { cn } from '@/lib/cn';

/**
 * How far through, as a bar and as the numbers behind it.
 *
 * The numbers are there because a bar alone is a shape rather than a fact:
 * "8 of 12" survives being read at a glance in a way that four fifths of a
 * rectangle does not.
 *
 * The bar is banded rather than a single green length. All green said one
 * thing -- the done fraction -- and left everything not done as blank track,
 * so a module held up by four unanswered questions and a module nobody has
 * got to yet drew the same picture. Each state now owns its share of the
 * length in the tone the health column beneath it already gives it: amber for
 * everything not yet takeable, blue for ready and underway, green for done. The tally beside it was already saying this in numbers; the
 * bar was the one thing on the row still claiming the module was simply
 * eight twelfths of the way there.
 */
export function Progress({
  label,
  progress,
  bands,
}: {
  label: string;
  progress: PlanProgress;
  bands: readonly PlanBand[];
}) {
  if (progress.fraction === null) return null;

  return (
    <span className="flex items-center gap-2">
      {/* `sunken`, not `canvas`. The track is what the bands are drawn on --
          but `--c-page` is defined as `var(--c-canvas)`, so a canvas track on
          a page is the page colour and there is no track at all. It shows
          through wherever a state is missing entirely, which on a module with
          no ready steps and no blocks is most of the bar's own rounding.
          Same reason the avatar tiles are sunken. */}
      <Bands
        bands={bands.map((band) => ({
          key: band.health,
          value: band.count,
          fill: TONE_DOT[HEALTH[band.health].tone],
          label: `${band.count} ${HEALTH[band.health].word.toLowerCase()}`,
        }))}
        track="sunken"
        className="w-24"
        label={label}
      />
      <span className="tabular text-small text-ink-muted">
        {progress.done} of {progress.live}
        {progress.inProgress > 0 && ` · ${progress.inProgress} underway`}
      </span>
    </span>
  );
}

/**
 * A module's steps, counted by state, beside its heading.
 *
 * The progress bar next to this answers "how far through", which is one
 * number and hides the shape of what is left: eleven not-started steps and
 * eleven unanswered questions are the same bar and are not the same module.
 * A count per state says which, without the section being opened -- and it
 * survives the fold, which is the point (law 10).
 *
 * Each count is marked with the state's hexagon rather than a round dot, so
 * "four blocked, two ready" is readable without telling the tones apart. Same
 * shape as the health column under it and the same size, because the two are
 * on screen together and a state that changed shape between them would read
 * as two states.
 *
 * Only states that are actually present are counted. A row of zeroes is noise,
 * and a "0 blocked" is a fact nobody needed (law 1). The count is the label:
 * the word is on the tooltip and in the accessible name, because eight
 * spelled-out states would be a paragraph where a glance was asked for.
 *
 * Answered is left out. Every other dot is either work outstanding or work
 * that shipped; an answered question is neither -- it is a decision recorded
 * and carried into the briefs beneath it, and it never becomes work again.
 * Counting them said nothing about the shape of what is left in a module,
 * which is the one thing these dots are for, and it was a dot on every
 * heading.
 */
const TALLY_HEALTHS = PLAN_HEALTHS.filter((health) => health !== 'answered');

export function SectionTally({ tally, label }: { tally: PlanTally; label: string }) {
  const present = TALLY_HEALTHS.filter((health) => tally[health] > 0);
  if (present.length === 0) return null;

  return (
    <span className="flex items-center gap-2.5" aria-label={`${label} by state`}>
      {present.map((health) => (
        <span
          key={health}
          className="flex items-center gap-1"
          title={`${tally[health]} ${HEALTH[health].word.toLowerCase()}`}
        >
          <StatusGlyph
            glyph={PLAN_HEALTH_GLYPHS[health]}
            className={TONE_TEXT[HEALTH[health].tone]}
          />
          <span className="tabular text-small text-ink-muted">{tally[health]}</span>
          <span className="sr-only">{HEALTH[health].word}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Ready, not ready, underway, done: the leaf steps beneath a feature, as dots.
 * Read from the roll-up rather than from the children on the page, so a
 * narrowed view that has folded the done steps away still counts them.
 *
 * Amber, blue, green, in that order (note 42aa1fa4): everything that cannot
 * be taken yet, blocked and waiting alike, then what is ready or underway, then
 * what is done. The same three colours the health column gives each state.
 */
export function Breakdown({ rollup }: { rollup: PlanProgress }) {
  const { done, inProgress, ready, live } = rollup;
  if (live === 0) return <span className="text-small text-ink-ghost">—</span>;

  const counts: Array<{ key: string; word: string; tone: DevTone; n: number }> = [
    { key: 'not-ready', word: 'not ready', tone: 'caution', n: live - done - inProgress - ready },
    { key: 'ready', word: 'ready or underway', tone: 'info', n: ready + inProgress },
    { key: 'done', word: 'done', tone: 'positive', n: done },
  ];
  const shown = counts.filter((c) => c.n > 0);
  const title = shown.map((c) => `${c.n} ${c.word}`).join(', ');

  return (
    <span
      className="tabular flex flex-wrap items-center gap-x-2 gap-y-0.5 text-small text-ink-muted"
      title={`${title} of ${live}`}
      aria-label={`${title} of ${live} steps`}
    >
      {shown.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1">
          <span className={cn('size-1.5 rounded-full', TONE_DOT[c.tone])} aria-hidden />
          {c.n}
        </span>
      ))}
    </span>
  );
}
