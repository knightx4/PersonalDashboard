import Link from 'next/link';
import { Disclosure, Group } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { ModuleMark } from '@/components/ui/module-mark';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { moduleById } from '@/lib/modules';
import { monthLabel } from '@/lib/timeline/months';
import type { ShownObservation } from '@/lib/timeline/observations-view';
import { eventRef, kindCount, TIMELINE_MODULES, type TimelineModule } from '@/lib/timeline/timeline';
import { moneyLine, TOPIC_HEADINGS, type YearTotals } from '@/lib/timeline/year-review';
import type { ShownParagraph, YearState } from '@/lib/timeline/year-review-view';
import { EventRow } from '../../event-row';
import { ObservationList } from '../../observations';
import { WriteYearButton } from './write-button';

/**
 * The year in review (plan #1121), apart from the reads so the surface
 * gallery can draw it from fixtures. What Dash wrote comes first, each
 * paragraph with the rows it cites behind "Show me"; then every number the
 * paragraphs may use, which is every number they do use; then what the
 * weekly runs noticed during the year.
 */

export type YearReviewViewProps = {
  year: number;
  /** Whether the review can be written now: false once one was written after the year ended. */
  writable: boolean;
  /** Whether the year is the one being lived in. */
  current: boolean;
  state: YearState;
  totals: YearTotals;
  paragraphs: ShownParagraph[];
  observations: ShownObservation[];
  timezone: string;
  /** The years to link to either side, or null. */
  earlier: number | null;
  later: number | null;
};

export function YearReviewView({
  year,
  writable,
  current,
  state,
  totals,
  paragraphs,
  observations,
  timezone,
  earlier,
  later,
}: YearReviewViewProps) {
  return (
    <div className="space-y-8">
      <YearStatus year={year} state={state} writable={writable} current={current} timezone={timezone} />

      {paragraphs.length > 0 && (
        <div className="space-y-6">
          {paragraphs.map((paragraph) => (
            <Group key={paragraph.topic} title={TOPIC_HEADINGS[paragraph.topic]}>
              <p className="text-body text-ink">{paragraph.text}</p>
              <Disclosure
                title="Show me"
                meta={
                  <span className="tabular">
                    {paragraph.events.length === 1 ? '1 row' : `${paragraph.events.length} rows`}
                  </span>
                }
              >
                {paragraph.events.length > 0 ? (
                  <ul className="divide-y divide-border border-y border-border">
                    {paragraph.events.map((event) => (
                      <EventRow key={eventRef(event)} event={event} timezone={timezone} withMonth />
                    ))}
                  </ul>
                ) : (
                  <p className="text-small text-ink-muted">The rows behind this have since been deleted.</p>
                )}
              </Disclosure>
            </Group>
          ))}
        </div>
      )}

      {totals.events > 0 && <YearNumbers totals={totals} />}

      {observations.length > 0 && (
        <Group title="Noticed during the year">
          <ObservationList observations={observations} timezone={timezone} />
        </Group>
      )}

      {(earlier || later) && (
        <nav aria-label="Other years" className="flex items-center justify-between gap-3 text-ui">
          {earlier ? (
            <Link href={`/timeline/year/${earlier}`} className="text-accent hover:underline">
              {`${earlier} in review`}
            </Link>
          ) : (
            <span />
          )}
          {later && (
            <Link href={`/timeline/year/${later}`} className="text-accent hover:underline">
              {`${later} in review`}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

function dayText(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone }).format(
    new Date(iso),
  );
}

function eventsText(count: number): string {
  return count === 1 ? '1 event' : `${count} events`;
}

/** What the page holds for this year, and the button that writes it when it can be written. */
function YearStatus({
  year,
  state,
  writable,
  current,
  timezone,
}: {
  year: number;
  state: YearState;
  writable: boolean;
  current: boolean;
  timezone: string;
}) {
  if (state.kind === 'empty') {
    return (
      <EmptyState
        title={`Nothing on the timeline in ${year}`}
        description="The timeline is read from what the workspaces already hold: orders, applications, finished tasks, notes, answers in Learn and goal steps. None of it falls in this year."
      />
    );
  }

  let line: string;
  if (state.kind === 'too-few') {
    line = `Only ${eventsText(state.events)} on the timeline ${state.events === 1 ? 'falls' : 'fall'} in ${year}, too few to write about. ${state.events === 1 ? 'It is' : 'They are'} counted below.`;
  } else if (state.kind === 'unwritten') {
    line = current
      ? `Dash has not written ${year} up yet. It can write the year so far, and again whenever you ask until the year ends.`
      : `Dash has not written ${year} up yet.`;
  } else {
    const upTo = state.complete
      ? `from the ${eventsText(state.eventsThen)} in the year`
      : `from the ${eventsText(state.eventsThen)} up to that day`;
    const since = state.eventsSince > 0 ? ` ${eventsText(state.eventsSince)} since then are not in it.` : '';
    line = `Written by Dash on ${dayText(state.writtenAt, timezone)}, ${upTo}.${since}`;
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="min-w-0 flex-1 text-ui text-ink-muted">{line}</p>
      {writable && state.kind !== 'too-few' && (
        <WriteYearButton year={year} again={state.kind === 'written'} />
      )}
    </div>
  );
}

function moduleLabel(module: TimelineModule): string {
  return moduleById(module)?.label ?? module;
}

/** Every number the paragraphs may cite: the year's counts, each month, the shops and the goals. */
function YearNumbers({ totals }: { totals: YearTotals }) {
  const modules = TIMELINE_MODULES.filter((module) =>
    totals.months.some((month) => month.modules.some((entry) => entry.module === module)),
  );
  return (
    <div className="space-y-6">
      <Group title="The year in numbers">
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-ui text-ink sm:grid-cols-2">
          <li className="tabular">{`${eventsText(totals.events)} on the timeline`}</li>
          {totals.kinds.map(({ kind, count }) => (
            <li key={kind} className="tabular">
              {kindCount(kind, count)}
            </li>
          ))}
          {totals.spent.length > 0 && <li className="tabular">{`${moneyLine(totals.spent)} spent on orders`}</li>}
          {totals.refunded.length > 0 && (
            <li className="tabular">{`${moneyLine(totals.refunded)} refunded on returns`}</li>
          )}
        </ul>
      </Group>

      <Group title="Each month">
        <Table>
          <THead>
            <tr>
              <TH>Month</TH>
              <TH num>Events</TH>
              {modules.map((module) => (
                <TH key={module} num>
                  <span className="inline-flex justify-end" title={moduleLabel(module)}>
                    <ModuleMark module={module} size="sm" />
                    <span className="sr-only">{moduleLabel(module)}</span>
                  </span>
                </TH>
              ))}
              <TH num>Spent</TH>
            </tr>
          </THead>
          <TBody>
            {totals.months.map((month) => (
              <TR key={month.key} href={`/timeline?to=${month.key}`}>
                <TD primary>{monthLabel(month.key).split(' ')[0]}</TD>
                <TD num label="Events">
                  {month.events}
                </TD>
                {modules.map((module) => (
                  <TD key={module} num muted label={moduleLabel(module)}>
                    {month.modules.find((entry) => entry.module === module)?.count ?? '·'}
                  </TD>
                ))}
                <TD num muted label="Spent">
                  {month.spent.length > 0 ? moneyLine(month.spent) : '·'}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Group>

      {totals.shops.length > 0 && (
        <Group title="Where the most was spent">
          <ul className="divide-y divide-border">
            {totals.shops.map((shop) => (
              <li key={shop.name} className="flex items-baseline justify-between gap-3 py-1.5 text-ui">
                <span className="min-w-0 truncate text-ink">{shop.name}</span>
                <span className="tabular shrink-0 text-ink-muted">
                  {`${shop.orders === 1 ? '1 order' : `${shop.orders} orders`} · ${moneyLine(shop.spent)}`}
                </span>
              </li>
            ))}
          </ul>
        </Group>
      )}

      {totals.goals.length > 0 && (
        <Group title="Goals that moved">
          <ul className="divide-y divide-border">
            {totals.goals.map((goal) => (
              <li key={goal.ref ?? goal.title} className="flex items-baseline justify-between gap-3 py-1.5 text-ui">
                {goal.ref ? (
                  <Link href={`/goals/${goal.ref}`} className="min-w-0 truncate text-ink hover:text-accent">
                    {goal.title}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate text-ink">{goal.title}</span>
                )}
                <span className="tabular shrink-0 text-ink-muted">
                  {goal.steps === 1 ? '1 step done' : `${goal.steps} steps done`}
                </span>
              </li>
            ))}
          </ul>
        </Group>
      )}
    </div>
  );
}
