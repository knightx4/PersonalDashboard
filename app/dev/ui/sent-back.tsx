import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { whenDate } from '@/lib/core/when';
import {
  AUDIT_WEEK,
  COMPLAINT_DAYS,
  sentBackShare,
  type SentBackWeek,
} from '@/lib/plan/sent-back';

/** The most weeks drawn: eight columns and their dates fit 390 pixels without scrolling sideways. */
const WEEKS_SHOWN = 8;

/** The tallest column, in pixels. */
const PLOT_HEIGHT = 112;

/** "5 Oct" from `2026-10-05`. */
function dayMonth(week: string): string {
  return whenDate(week, { timeZone: 'UTC', year: 'auto' });
}

/** "1/7": steps sent back over steps shipped, or "none" for a week that shipped nothing. */
function countLine(week: SentBackWeek): string {
  return week.shipped === 0 ? 'none' : `${week.sentBack}/${week.shipped}`;
}

/**
 * The count for plan #2215: each week, the share of screen steps shipped that
 * the person sent back or complained about, so it is clear whether building
 * to the approved mockup worked. One series, so no legend; each column
 * carries its value on the cap and its counts under the date, which is the
 * table view as well. The week of the audit that started the feature is
 * marked, with the figures from before it in the note beneath.
 *
 * `weeks` is null when the record could not be read, and empty before any
 * step has passed a design check.
 */
export function SentBackChart({ weeks }: { weeks: readonly SentBackWeek[] | null }) {
  if (weeks === null) {
    return (
      <Card padding="standard" className="text-body text-ink-muted">
        The design checks or the notes could not be read just now, so the weeks are not counted.
      </Card>
    );
  }
  if (weeks.length === 0) {
    return (
      <Card padding="standard" className="text-body text-ink-muted">
        No step has passed a design check yet, so there is nothing to count.
      </Card>
    );
  }

  const shown = weeks.slice(-WEEKS_SHOWN);
  const top = Math.max(1, ...shown.map((week) => sentBackShare(week) ?? 0));

  return (
    <Card padding="standard" className="space-y-3">
      <ol
        className="grid items-start gap-1"
        style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}
      >
        {shown.map((week) => {
          const share = sentBackShare(week);
          const height = share === null ? 0 : Math.max(2, Math.round((share / top) * PLOT_HEIGHT));
          const audit = week.week === AUDIT_WEEK;
          const said =
            (share === null
              ? `Week of ${dayMonth(week.week)}: no screen steps shipped`
              : `Week of ${dayMonth(week.week)}: ${week.sentBack} of ${week.shipped} screen steps, ${share}%`) +
            (audit ? ', the week of the audit' : '');
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
                {share === null ? (
                  <span
                    // ui-ok: hand-rolled-box -- an outline of a bar, not a grouping frame
                    className="mt-1 block w-full max-w-6 rounded-t-control border border-dashed border-b-0 border-border-strong"
                    style={{ height: PLOT_HEIGHT }}
                  />
                ) : (
                  <span
                    className="mt-1 block w-full max-w-6 rounded-t-control bg-accent"
                    style={{ height }}
                  />
                )}
              </div>
              <span aria-hidden className="block h-px w-full bg-border" />
              <span aria-hidden className="mt-1 whitespace-nowrap text-micro text-ink-muted">
                {dayMonth(week.week)}
              </span>
              <span aria-hidden className="tabular whitespace-nowrap text-micro text-ink-ghost">
                {countLine(week)}
              </span>
              <span aria-hidden className="whitespace-nowrap text-micro text-ink">
                {audit ? 'Audit' : ' '}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-small text-ink-muted">
        Screen steps sent back or complained about, over those shipped, by week from Monday.
      </p>
      <Disclosure title="How a step is counted" remember="ui-sent-back-counted">
        <p className="max-w-prose text-small text-ink-muted">
          A step counts when you sent it back from its row, or when a note about its page is about
          how it looks and was filed within {COMPLAINT_DAYS} days of its design check passing.
          Before the audit (the week marked), none of 285 screen steps were sent back, because the
          button had no pictures to show, and look complaints ran about 9 a week until the critic
          began on 4 October, then about 4.
        </p>
      </Disclosure>
    </Card>
  );
}
