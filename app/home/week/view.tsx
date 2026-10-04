import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { eventRef } from '@/lib/timeline/timeline';
import {
  dayLabel,
  weekRangeLabel,
  weekShortLabel,
  whenLabel,
  type ShownWeekReview,
} from '@/lib/week-review/view';
import { EventRow } from '@/app/timeline/event-row';
import { DashCredit } from '@/components/ui/dash-mark';

/**
 * The weekly review (plan #1233), apart from the reads. Whether last week's
 * change happened comes first, then each observation with both weeks'
 * figures, the goal it bears on and the rows behind it, then the one thing to
 * change next week, then the other weeks.
 */

export type WeekReviewViewProps =
  | { state: 'none'; next: { day: string; due: boolean } }
  | { state: 'missing'; week: string; weeks: string[] }
  | { state: 'shown'; review: ShownWeekReview; weeks: string[]; timezone: string };

const HOME_LINK = (
  <Link href="/home" className="press-area text-ui text-accent hover:underline">
    Home
  </Link>
);

export function WeekReviewView(props: WeekReviewViewProps) {
  if (props.state === 'none') {
    const when = props.next.due
      ? 'Dash writes the first one this morning, from 9:00\u00a0AM New York time, so it should be here within the hour.'
      : `Dash writes the first one on ${dayLabel(props.next.day)} at 9:00\u00a0AM New York time.`;
    return (
      <>
        <PageHeader title="The week in review" actions={HOME_LINK} />
        <EmptyState
          title="No weekly review yet"
          description={`${when} Each Sunday it looks at the week just gone, Sunday to Saturday: what moved against the week before, which goal each change bears on, and one thing to change next week.`}
        />
      </>
    );
  }

  if (props.state === 'missing') {
    return (
      <>
        <PageHeader title={weekRangeLabel(props.week)} actions={HOME_LINK} />
        <EmptyState
          title="No review for this week"
          description="Dash wrote no review for this week. Reviews start from the first Sunday the weekly run reached you."
          action={{ label: 'The latest review', href: '/home/week' }}
        />
        <OtherWeeks week={props.week} weeks={props.weeks} />
      </>
    );
  }

  const { review, weeks, timezone } = props;
  const written = whenLabel(review.writtenAt, timezone);
  const description =
    review.source === 'plain' && review.observations.length > 0
      ? `Dash could not write this week up, so these are the figures that moved most, set out by the app on ${written}.`
      : `Written by Dash on ${written}.`;

  return (
    <>
      <PageHeader
        title={weekRangeLabel(review.week)}
        description={
          review.source === 'plain' && review.observations.length > 0 ? (
            description
          ) : (
            <>
              <DashCredit />
              {description}
            </>
          )
        }
        actions={HOME_LINK}
      />
      <div className="space-y-8">
        {review.lastChange && <p className="text-ui text-ink-muted">{review.lastChange}</p>}

        {review.observations.length > 0 ? (
          <ol className="divide-y divide-border">
            {review.observations.map((observation, index) => (
              <li key={index} className="space-y-2 py-4 first:pt-0 last:pb-0">
                <p className="text-body text-ink">{observation.text}</p>
                {observation.figures.length > 0 && (
                  <ul className="space-y-0.5">
                    {observation.figures.map((figure) => (
                      <li key={figure.id} className="tabular text-small text-ink-muted">
                        {`${figure.label.charAt(0).toUpperCase()}${figure.label.slice(1)}: `}
                        <span className="font-medium text-ink">{figure.value}</span>
                        {` this week, ${figure.previous} the week before`}
                      </li>
                    ))}
                  </ul>
                )}
                {observation.goal && (
                  <p className="text-small text-ink-muted">
                    {'Bears on '}
                    <Link href={`/goals/${observation.goal.id}`} className="font-medium text-accent hover:underline">
                      {observation.goal.title}
                    </Link>
                  </p>
                )}
                {observation.events.length > 0 && (
                  <Disclosure
                    title="Show me"
                    meta={
                      <span className="tabular">
                        {observation.events.length === 1 ? '1 row' : `${observation.events.length} rows`}
                      </span>
                    }
                  >
                    <ul className="divide-y divide-border border-y border-border">
                      {observation.events.map((event) => (
                        <EventRow key={eventRef(event)} event={event} timezone={timezone} />
                      ))}
                    </ul>
                  </Disclosure>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            tone="finished"
            seed={`week:${review.week}`}
            title="A quiet week"
            description="Nothing the app counts happened this week or the week before: no applications, orders, readings, notes, finished tasks or goal steps. There was nothing to compare, so Dash wrote no observations."
          />
        )}

        {review.change && (
          <Card padding="standard">
            <h2 className="text-ui font-semibold text-ink">To change next week</h2>
            <p className="mt-1 text-body text-ink">{review.change}</p>
          </Card>
        )}

        <OtherWeeks week={review.week} weeks={weeks} />
      </div>
    </>
  );
}

/** The weeks either side, and every week with a review under a fold. */
function OtherWeeks({ week, weeks }: { week: string; weeks: string[] }) {
  // Newest first, so the earlier week is the first one after this in the list.
  const earlier = weeks.find((other) => other < week) ?? null;
  const later = [...weeks].reverse().find((other) => other > week) ?? null;
  const others = weeks.filter((other) => other !== week);
  if (others.length === 0) return null;
  return (
    <div className="space-y-4">
      {(earlier || later) && (
        <nav aria-label="Other weeks" className="flex items-center justify-between gap-3 text-ui">
          {earlier ? (
            <Link href={`/home/week/${earlier}`} className="press-area text-accent hover:underline">
              {weekShortLabel(earlier)}
            </Link>
          ) : (
            <span />
          )}
          {later && (
            <Link href={`/home/week/${later}`} className="press-area text-accent hover:underline">
              {weekShortLabel(later)}
            </Link>
          )}
        </nav>
      )}
      {others.length > 1 && (
        <Disclosure
          title="Every week"
          meta={<span className="tabular">{weeks.length === 1 ? '1 review' : `${weeks.length} reviews`}</span>}
        >
          <ul className="divide-y divide-border border-y border-border">
            {weeks.map((other) => (
              <li key={other}>
                {other === week ? (
                  <span className="block px-1 py-3 text-ui font-medium text-ink">{weekRangeLabel(other)}</span>
                ) : (
                  <Link href={`/home/week/${other}`} className="block px-1 py-3 text-ui text-ink hover:bg-sunken">
                    {weekRangeLabel(other)}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}
