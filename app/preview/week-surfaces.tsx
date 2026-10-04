import { WeekReviewView } from '@/app/home/week/view';
import type { TimelineEvent } from '@/lib/timeline/timeline';
import type { ShownWeekReview } from '@/lib/week-review/view';

/**
 * The week in review (plan #1233) in the surface gallery (plan #1600): a
 * week Dash wrote up, with last week's change judged, three observations
 * with their figures, goals and rows, and the change for next week; then the
 * page before the first review exists. Both are drawn in the shell's 3xl
 * column, as the Week layout draws them.
 */

function event(
  id: string,
  occurred_at: string,
  module: TimelineEvent['module'],
  kind: TimelineEvent['kind'],
  title: string,
  detail: string | null = null,
): TimelineEvent {
  return {
    occurred_at,
    module,
    kind,
    title,
    detail,
    amount_cents: null,
    currency: null,
    source_table: 'fixture.rows',
    source_id: id,
    link_ref: null,
    ref: `fixture.rows:${id}`,
  };
}

const REVIEW: ShownWeekReview = {
  week: '2026-09-27',
  source: 'model',
  writtenAt: '2026-10-04T13:04:00Z',
  lastChange:
    'Last week you meant to send two applications before Wednesday. You sent three, the first on Monday.',
  observations: [
    {
      text: 'You applied to three roles this week against one the week before, all of them finance roles at companies under 500 people.',
      goal: { id: 'g1', title: 'Land a strategic finance role at a growth-stage company before the end of the year' },
      figures: [
        { id: 'applied', label: 'applications sent', value: '3', previous: '1' },
        { id: 'interviews', label: 'interviews', value: '1', previous: '0' },
      ],
      events: [
        event('e1', '2026-10-02T15:00:00Z', 'jobs', 'interviewed', 'FP&A Analyst at Array', 'hiring manager'),
        event('e2', '2026-09-30T06:10:00Z', 'jobs', 'applied', 'Strategic Finance Associate at Check'),
        event('e3', '2026-09-29T17:52:00Z', 'jobs', 'applied', 'Senior Financial Analyst, Revenue Operations and Planning at Ramp'),
      ],
    },
    {
      text: 'Reading slowed: two readings finished against five, and none on the cohort analysis list you started.',
      goal: null,
      figures: [{ id: 'readings', label: 'readings finished', value: '2', previous: '5' }],
      events: [event('e4', '2026-09-28T20:30:00Z', 'learn', 'probe_answered', 'Cohort-based measurement', 'wrong')],
    },
    {
      text: 'Nine tasks done, the most in a month.',
      goal: null,
      figures: [{ id: 'tasks', label: 'tasks done', value: '9', previous: '4' }],
      events: [],
    },
  ],
  change: 'Finish one reading from the cohort analysis list before Thursday, before the Array follow-up.',
};

const WEEKS = ['2026-09-27', '2026-09-20', '2026-09-13', '2026-09-06'];

export function WeekReviewSurface() {
  return (
    <div className="mx-auto max-w-3xl">
      <WeekReviewView state="shown" review={REVIEW} weeks={WEEKS} timezone="America/New_York" />
    </div>
  );
}

export function WeekReviewNoneSurface() {
  return (
    <div className="mx-auto max-w-3xl">
      <WeekReviewView state="none" next={{ day: '2026-10-11', due: false }} />
    </div>
  );
}
