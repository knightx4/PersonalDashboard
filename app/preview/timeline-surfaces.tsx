import { PageHeader } from '@/components/shell/page-header';
import { TimelineView } from '@/app/timeline/view';
import { YearReviewView } from '@/app/timeline/year/[year]/view';
import { groupByMonth } from '@/lib/timeline/months';
import type { ShownObservation } from '@/lib/timeline/observations-view';
import { TIMELINE_MODULES, type TimelineEvent } from '@/lib/timeline/timeline';
import { yearTotals } from '@/lib/timeline/year-review';

/**
 * The timeline page (plan #1118) in the surface gallery, from typed fixtures
 * shaped like the live rows: jobs outnumber everything, a run of vault notes
 * mid-month, a couple of orders, and an older month that stays folded.
 */

let n = 0;
function row(
  occurred_at: string,
  module: TimelineEvent['module'],
  kind: TimelineEvent['kind'],
  title: string,
  detail: string | null = null,
  amount_cents: number | null = null,
): TimelineEvent {
  n += 1;
  return {
    occurred_at,
    module,
    kind,
    title,
    detail,
    amount_cents,
    currency: amount_cents == null ? null : 'USD',
    source_table: 'fixture.rows',
    source_id: `row-${n}`,
    link_ref: null,
    ref: `fixture.rows:row-${n}`,
  };
}

const EVENTS: TimelineEvent[] = [
  row('2026-09-27T00:40:00Z', 'goals', 'step_done', 'Review your resume for what a recruiter sees first', 'Land your next role'),
  row('2026-09-26T06:10:00Z', 'jobs', 'applied', 'Strategic Finance Associate at Check'),
  row('2026-09-25T17:52:00Z', 'jobs', 'rejected', 'Financial Analyst, Technology at Sophos', 'resume review'),
  row('2026-09-25T15:00:00Z', 'jobs', 'interviewed', 'FP&A Analyst at Array', 'hiring manager'),
  row('2026-09-24T00:43:00Z', 'learn', 'probe_answered', 'Cohort-based measurement', 'wrong'),
  row('2026-09-22T20:30:00Z', 'vault', 'note_written', 'Yale Combined'),
  row('2026-09-22T19:48:00Z', 'learn', 'placement_answered', 'Economics', 'Game theory and strategic interaction'),
  row('2026-09-22T13:24:00Z', 'todo', 'task_done', 'Vote music'),
  row('2026-09-21T16:00:00Z', 'shopping', 'ordered', 'James Avery Artisan Jewelry', 'E1004820684', 6097),
  row('2026-09-18T11:05:00Z', 'vault', 'note_written', 'Notes on the Array interview loop'),
  row('2026-09-17T09:12:00Z', 'jobs', 'applied', 'Senior Financial Analyst at Ramp'),
  row('2026-09-15T14:30:00Z', 'jobs', 'rejected', 'Corporate Development Analyst at Brex', 'applied'),
  row('2026-09-01T13:28:00Z', 'jobs', 'withdrew', 'Engagement Lead, Future Platforms at EliseAI'),
  row('2026-08-28T10:00:00Z', 'jobs', 'applied', 'FP&A Analyst at Array'),
  row('2026-08-20T16:00:00Z', 'shopping', 'ordered', 'Uniqlo', 'W123', 8450),
  row('2026-08-12T09:00:00Z', 'jobs', 'applied', 'Finance Associate at Mercury'),
  row('2026-08-05T18:22:00Z', 'jobs', 'rejected', 'Strategy Analyst at Plaid', 'phone screen'),
  row('2026-06-14T16:00:00Z', 'shopping', 'ordered', 'REI Co-op', 'R-88410', 21399),
];

/** One observation the weekly run might write for these rows (plan #1120). */
const OBSERVATIONS: ShownObservation[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    week: '2026-09-21',
    sentence:
      'In the 3 weeks after a rejection you placed 2 orders; in the 3 weeks after an application with no answer yet you placed none.',
    modules: ['shopping', 'jobs'],
    events: EVENTS.filter((event) => event.kind === 'rejected' || event.kind === 'ordered').slice(0, 5),
  },
];

export function TimelineSurface() {
  const months = groupByMonth(EVENTS, 'America/New_York', { first: '2025-10', last: '2026-09' });
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Timeline" description="What you did across the app, month by month." />
      <TimelineView
        months={months}
        modules={TIMELINE_MODULES}
        module={null}
        to={null}
        earlier="2025-04"
        later={null}
        timezone="America/New_York"
        observations={OBSERVATIONS}
      />
    </div>
  );
}

/**
 * The year in review (plan #1121) from the same rows: the counts are worked
 * out from them as the page does, and the paragraphs are ones the checks
 * would keep, each number in them shown further down.
 */
export function YearReviewSurface() {
  const timezone = 'America/New_York';
  const year = EVENTS.filter((event) => event.occurred_at >= '2026-01-01T05:00:00Z');
  const totals = yearTotals(year, 2026, timezone, '2026-09');
  const of = (...kinds: TimelineEvent['kind'][]) => year.filter((event) => kinds.includes(event.kind));
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="2026 in review" description="What the year held, counted from the timeline and written up by Dash." />
      <YearReviewView
        year={2026}
        writable
        current
        state={{
          kind: 'written',
          writtenAt: '2026-09-27T12:00:00Z',
          through: '2026-09-27T12:00:00Z',
          complete: false,
          eventsThen: totals.events,
          eventsSince: 0,
        }}
        totals={totals}
        paragraphs={[
          {
            topic: 'shopping',
            text: 'You placed 3 orders for $359.46, and $213.99 of it went to REI Co-op in June.',
            events: of('ordered'),
          },
          {
            topic: 'jobs',
            text: 'You sent 4 applications and had 1 interview, at Array in September. 3 applications ended in a rejection and you withdrew from 1.',
            events: of('applied', 'interviewed', 'rejected', 'withdrew'),
          },
        ]}
        observations={OBSERVATIONS}
        timezone={timezone}
        earlier={2025}
        later={null}
      />
    </div>
  );
}
