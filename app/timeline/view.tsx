import Link from 'next/link';
import { SectionFold } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { ModuleMark } from '@/components/ui/module-mark';
import { segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { moduleById } from '@/lib/modules';
import { formatMoney } from '@/lib/money';
import type { MonthKey, TimelineMonth } from '@/lib/timeline/months';
import {
  KIND_NOUNS,
  eventRef,
  kindCount,
  timelineHref,
  type TimelineEvent,
  type TimelineModule,
} from '@/lib/timeline/timeline';

/**
 * The timeline page's body (plan #1118), apart from the reads so the surface
 * gallery can draw it from fixtures. Everything here is markup: the months
 * fold with native `<details>`, the filter is links, and nothing needs
 * JavaScript to work.
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
};

export function timelineUrl({ module, to }: { module: TimelineModule | null; to: MonthKey | null }): string {
  const params = new URLSearchParams();
  if (module) params.set('module', module);
  if (to) params.set('to', to);
  const query = params.toString();
  return query ? `/timeline?${query}` : '/timeline';
}

export function TimelineView({ months, modules, module, to, earlier, later, timezone }: TimelineViewProps) {
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
          {months.map((month, index) => (
            <SectionFold
              key={month.key}
              title={month.label}
              hint={<span className="tabular">{month.counts.map((c) => kindCount(c.kind, c.count)).join(' · ')}</span>}
              // The newest month is the one being lived in; the rest are
              // history, and their counts are on the closed line.
              defaultOpen={index === 0}
            >
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
            <Link href={timelineUrl({ module, to: later === 'now' ? null : later })} className="text-accent hover:underline">
              Later months
            </Link>
          ) : (
            <span />
          )}
          {earlier && (
            <Link href={timelineUrl({ module, to: earlier })} className="text-accent hover:underline">
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
              className={cn(
                'press inline-flex h-(--control-h) shrink-0 items-center px-2.5 text-ui font-medium whitespace-nowrap',
                'transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2',
                on ? 'bg-accent-tint text-accent' : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
              )}
            >
              {option.label}
            </Link>
          );
        })}
      </span>
    </div>
  );
}

function EventRow({ event, timezone }: { event: TimelineEvent; timezone: string }) {
  const what = KIND_NOUNS[event.kind].one;
  const second = [
    what.charAt(0).toUpperCase() + what.slice(1),
    event.amount_cents != null ? formatMoney(event.amount_cents, event.currency ?? 'USD') : null,
    // An order's detail is its order number, which the amount says more usefully.
    event.kind === 'ordered' ? null : event.detail,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li>
      <Link href={timelineHref(event)} className="flex items-center gap-3 px-1 py-2 hover:bg-sunken">
        <span className="tabular w-12 shrink-0 text-small text-ink-muted">{dayLabel(event.occurred_at, timezone)}</span>
        <ModuleMark module={event.module} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui text-ink">{event.title}</span>
          <span className="block truncate text-small text-ink-muted">{second}</span>
        </span>
      </Link>
    </li>
  );
}

/** "Sat 26", on the person's calendar. */
function dayLabel(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', timeZone: timezone }).format(
    new Date(iso),
  );
}

function moduleLabel(module: TimelineModule): string {
  return moduleById(module)?.label ?? module;
}
