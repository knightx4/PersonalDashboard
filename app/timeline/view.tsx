import Link, { linkVariants } from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { segmentClass, segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/money';
import { moduleById } from '@/lib/modules';
import { monthLabel, monthTotals, type MonthKey, type TimelineMonth } from '@/lib/timeline/months';
import { weekLabel, type ShownObservation } from '@/lib/timeline/observations-view';
import { eventRef, kindCount, type TimelineModule } from '@/lib/timeline/timeline';
import { EventRow } from './event-row';
import { ObservationList } from './observations';

/**
 * The timeline page's body (plan #1118), apart from the reads so the surface
 * gallery can draw it from fixtures. Everything here is markup: the months
 * fold with native `<details>`, the filter is links, and nothing needs
 * JavaScript to work. With it, a month you fold stays folded (plan #1432).
 */

export type TimelineViewProps = {
  months: TimelineMonth[];
  /** The modules the filter offers: the ones the timeline reads that are switched on. */
  modules: readonly TimelineModule[];
  /** The one the page is narrowed to, or null for all of them. */
  module: TimelineModule | null;
  /** The last month the page shows, when it is not the current one. */
  to: MonthKey | null;
  /** The month to show from for "Earlier", or null when nothing is older. */
  earlier: MonthKey | null;
  /** The month to show from for "Later", or null when this page is the newest. */
  later: MonthKey | 'now' | null;
  timezone: string;
  /**
   * The weekly observations for the weeks on this page, not useful ones
   * already left out. Each shows at the top of the month its week begins in.
   */
  observations?: ShownObservation[];
  /** The first and last month of the page, for the chart above the months. */
  bounds?: { first: MonthKey; last: MonthKey };
};

export function timelineUrl({ module, to }: { module: TimelineModule | null; to: MonthKey | null }): string {
  const params = new URLSearchParams();
  if (module) params.set('module', module);
  if (to) params.set('to', to);
  const query = params.toString();
  return query ? `/timeline?${query}` : '/timeline';
}

export function TimelineView({
  months,
  modules,
  module,
  to,
  earlier,
  later,
  timezone,
  observations = [],
  bounds,
}: TimelineViewProps) {
  return (
    <>
      {modules.length > 1 && <ModuleFilter modules={modules} module={module} to={to} />}

      {months.length === 0 ? (
        <EmptyState
          title={module ? `Nothing from ${moduleLabel(module)} in these months` : 'Nothing in these months'}
          description="The timeline is read from what the workspaces already hold: orders, applications, finished tasks, notes, answers in Learn and goal steps. Once any of them has something in it, it shows here by month."
        />
      ) : (
        <div className="space-y-4">
          {bounds && <MonthChart months={months} bounds={bounds} />}
          {months.map((month, index) => (
            <SectionFold
              key={month.key}
              remember={`timeline.fold.${month.key}`}
              title={month.label}
              hint={<span className="tabular">{month.counts.map((c) => kindCount(c.kind, c.count)).join(' · ')}</span>}
              // The newest month is the one being lived in; the rest are
              // history, and their counts are on the closed line.
              defaultOpen={index === 0}
            >
              <MonthObservations
                observations={observations.filter((observation) => observation.week.slice(0, 7) === month.key)}
                timezone={timezone}
              />
              <ul className="divide-y divide-border border-y border-border">
                {month.events.map((event) => (
                  <EventRow key={eventRef(event)} event={event} timezone={timezone} />
                ))}
              </ul>
            </SectionFold>
          ))}
        </div>
      )}

      {(earlier || later) && (
        <nav aria-label="More months" className="mt-6 flex items-center justify-between gap-3 text-ui">
          {later ? (
            <Link href={timelineUrl({ module, to: later === 'now' ? null : later })} className={linkVariants()}>
              Later months
            </Link>
          ) : (
            <span />
          )}
          {earlier && (
            <Link href={timelineUrl({ module, to: earlier })} className={linkVariants()}>
              Earlier months
            </Link>
          )}
        </nav>
      )}
    </>
  );
}

function ModuleFilter({
  modules,
  module,
  to,
}: {
  modules: readonly TimelineModule[];
  module: TimelineModule | null;
  to: MonthKey | null;
}) {
  const options: { key: TimelineModule | null; label: string }[] = [
    { key: null, label: 'All' },
    ...modules.map((id) => ({ key: id, label: moduleLabel(id) })),
  ];
  return (
    // Seven segments do not fit a phone's width, so the set scrolls sideways
    // inside itself rather than pushing the page wider.
    <div className="mb-5 max-w-full overflow-x-auto">
      <span role="group" aria-label="Which workspace" className={segmentedFrame}>
        {options.map((option) => {
          const on = option.key === module;
          return (
            <Link
              key={option.key ?? 'all'}
              href={timelineUrl({ module: option.key, to })}
              scroll={false}
              aria-current={on ? 'true' : undefined}
              className={cn(segmentClass(on), 'shrink-0 whitespace-nowrap')}
            >
              {option.label}
            </Link>
          );
        })}
      </span>
    </div>
  );
}

/**
 * What the weekly run noticed in the weeks that begin in this month, one
 * block per week above the month's events. Nothing when it noticed nothing.
 */
function MonthObservations({ observations, timezone }: { observations: ShownObservation[]; timezone: string }) {
  const weeks = [...new Set(observations.map((observation) => observation.week))];
  if (weeks.length === 0) return null;
  return (
    <div className="mb-3 space-y-3">
      {weeks.map((week) => (
        <section key={week} aria-label={`What Dash noticed, ${weekLabel(week).toLowerCase()}`}>
          <h3 className="mb-1.5 text-small font-medium text-ink-muted">
            {`Dash noticed · ${weekLabel(week).toLowerCase()}`}
          </h3>
          <ObservationList
            observations={observations.filter((observation) => observation.week === week)}
            timezone={timezone}
          />
        </section>
      ))}
    </div>
  );
}

/**
 * How much happened in each month of the page, oldest on the left (note
 * 4968526a), above the months themselves. Every month of the window has a
 * slot, and an empty one is a stub on the baseline, so a quiet stretch reads
 * as quiet rather than as missing. Each bar carries its count, so the reading
 * never rests on height alone. Plain markup, like the rest of the page.
 */
function MonthChart({ months, bounds }: { months: TimelineMonth[]; bounds: { first: MonthKey; last: MonthKey } }) {
  const totals = monthTotals(months, bounds);
  const total = totals.reduce((sum, month) => sum + month.count, 0);
  const label = totals
    .map((month) => `${monthLabel(month.key)}: ${month.count}`)
    .join(', ');
  return (
    <Card padding="standard" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-ui font-semibold text-ink">By month</h2>
        <p className="tabular text-small text-ink-muted">
          {`${formatNumber(total)} from ${monthLabel(bounds.first)} to ${monthLabel(bounds.last)}`}
        </p>
      </div>
      <figure role="img" aria-label={`Things that happened by month. ${label}.`} className="space-y-1">
        <div aria-hidden className="flex h-32 items-end gap-1 border-b border-border-strong">
          {totals.map((month) => (
            <div key={month.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              {month.count > 0 && <span className="tabular text-small text-ink-muted">{month.count}</span>}
              {month.count === 0 ? (
                <div className="h-1 w-full max-w-10 rounded-t-control border border-b-0 border-border-strong" />
              ) : (
                <div
                  className="w-full max-w-10 rounded-t-control bg-accent"
                  style={{ height: `max(2px, calc((100% - 1.25rem) * ${month.share}))` }}
                />
              )}
            </div>
          ))}
        </div>
        <div aria-hidden className="flex gap-1">
          {totals.map((month) => (
            <span key={month.key} className="min-w-0 flex-1 text-center text-small text-ink-muted">
              {/* Twelve three-letter months do not fit a phone's width, so
                  there each is its initial. */}
              <span className="sm:hidden">{shortMonth(month.key).charAt(0)}</span>
              <span className="hidden sm:inline">{shortMonth(month.key)}</span>
            </span>
          ))}
        </div>
      </figure>
    </Card>
  );
}

/** "Oct", and "Jan" with no year: the heading names the years. */
function shortMonth(key: MonthKey): string {
  return new Date(`${key}-01T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
}

function moduleLabel(module: TimelineModule): string {
  return moduleById(module)?.label ?? module;
}
