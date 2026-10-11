import { Card } from '@/components/ui/card';
import { RECENT_DAYS, sharePercent, type CorrectionWeek } from '@/lib/plan/correction-share';

/** The most weeks drawn: eight columns and their dates fit 390 pixels without scrolling sideways. */
const WEEKS_SHOWN = 8;

/** The tallest column, in pixels. */
const PLOT_HEIGHT = 112;

/** "5 Oct" from `2026-10-05`. */
function dayMonth(week: string): string {
  return new Date(`${week}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

/** "1/7": corrections over notes, or "none" for a week with no notes. */
function countLine(week: CorrectionWeek): string {
  if (week.notes === 0) return 'none';
  return `${week.corrections}/${week.notes}`;
}

/**
 * Part 7 of docs/UI-QUALITY-SPEC.md, drawn: each week's share of the
 * person's notes that correct a screen changed in the 30 days before (plan
 * #1543). One series, so no legend; each column carries its value on the
 * cap and its counts under the date, which is the table view as well. The
 * columns scale to the largest share on show rather than to 100%, since the
 * point is the trend from week to week and a few percent would otherwise be
 * a hairline.
 *
 * `weeks` is null when the record could not be read, and empty before any
 * step has passed a design check.
 */
export function CorrectionsChart({ weeks }: { weeks: readonly CorrectionWeek[] | null }) {
  if (weeks === null) {
    return (
      <Card padding="standard" className="text-body text-ink-muted">
        The notes or the design checks could not be read just now, so this week is not counted.
      </Card>
    );
  }
  if (weeks.length === 0) {
    return (
      <Card padding="standard" className="text-body text-ink-muted">
        No step has passed a design check yet, so no screen has changed and there is nothing to
        count.
      </Card>
    );
  }

  const shown = weeks.slice(-WEEKS_SHOWN);
  const top = Math.max(1, ...shown.map((week) => sharePercent(week) ?? 0));

  return (
    <Card padding="standard" className="space-y-3">
      <ol
        className="grid items-start gap-1"
        style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}
      >
        {shown.map((week) => {
          const share = sharePercent(week);
          const height = share === null ? 0 : Math.max(2, Math.round((share / top) * PLOT_HEIGHT));
          const said =
            share === null
              ? `Week of ${dayMonth(week.week)}: no notes`
              : `Week of ${dayMonth(week.week)}: ${week.corrections} of ${week.notes} notes, ${share}%`;
          return (
            <li key={week.week} className="flex min-w-0 flex-col items-center" title={said}>
              <span className="sr-only">{said}</span>
              <div
                aria-hidden
                className="flex w-full flex-col items-center justify-end"
                style={{ height: PLOT_HEIGHT + 20 }}
              >
                <span className="tabular text-small text-ink">
                  {share === null ? '–' : `${share}%`}
                </span>
                <span
                  className="mt-1 block w-full max-w-6 rounded-t bg-accent"
                  style={{ height }}
                />
              </div>
              <span aria-hidden className="block h-px w-full bg-border" />
              <span aria-hidden className="mt-1 whitespace-nowrap text-micro text-ink-muted">
                {dayMonth(week.week)}
              </span>
              <span aria-hidden className="tabular whitespace-nowrap text-micro text-ink-ghost">
                {countLine(week)}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-small text-ink-muted">
        Under each week, the notes that counted over all the notes filed. Weeks start on Monday.
        A note counts when its page is one a step changed in the{' '}
        {RECENT_DAYS} days before it, or when it was filed against that screen on Surfaces.
      </p>
    </Card>
  );
}
