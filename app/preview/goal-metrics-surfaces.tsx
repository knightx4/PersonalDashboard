import { GoalMetrics, type MetricView } from '@/app/goals/[goalId]/goal-metrics';
import { countByPeriod, type MetricPeriod } from '@/lib/goals/metrics';

/**
 * A goal's metrics on its Overview, drawn from fixtures for the gallery
 * (plan #2084.2). The counts go through countByPeriod, as the store's do, so
 * the bars are what the stored records would give on 15 Oct 2026.
 */

const NOW = new Date('2026-10-15T12:00:00Z');
const ZONE = 'Europe/London';

function counted(
  period: MetricPeriod,
  startedAt: string,
  days: readonly string[],
): MetricView['counts'] {
  return countByPeriod({
    records: days.map((day) => ({ data: { applied_on: day }, draft: false })),
    dateField: 'applied_on',
    period,
    goalStartedAt: startedAt,
    now: NOW,
    timeZone: ZONE,
  });
}

/** Twelve weeks of applications, three a week aimed for, two so far this week. */
const APPLICATIONS: MetricView = {
  id: 'm-applications',
  name: 'Applications sent',
  period: 'week',
  target: 3,
  list: 'Job applications',
  field: 'Applied on',
  counts: counted('week', '2026-07-01T09:00:00Z', [
    '2026-07-21', '2026-07-23', '2026-07-30', '2026-08-04', '2026-08-05', '2026-08-06',
    '2026-08-07', '2026-08-19', '2026-08-26', '2026-08-27', '2026-09-01', '2026-09-02',
    '2026-09-03', '2026-09-15', '2026-09-16', '2026-09-22', '2026-09-23', '2026-09-24',
    '2026-09-25', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-13', '2026-10-14',
  ]),
};

/** Five months of interviews and no target: a goal started in June. */
const INTERVIEWS: MetricView = {
  id: 'm-interviews',
  name: 'First-round interviews with hiring managers at companies on the shortlist',
  period: 'month',
  target: null,
  list: 'Job applications',
  field: 'Interview on',
  counts: counted('month', '2026-06-10T09:00:00Z', [
    '2026-07-14', '2026-08-20', '2026-08-28', '2026-09-03', '2026-09-11', '2026-09-30',
    '2026-10-02',
  ]),
};

/** A target well above every count, so the scale stretches to hold it. */
const RUNS: MetricView = {
  id: 'm-runs',
  name: 'Runs',
  period: 'week',
  target: 4,
  list: 'Training log',
  field: 'Date',
  counts: counted('week', '2026-09-20T09:00:00Z', ['2026-09-22', '2026-10-01', '2026-10-03']),
};

/** A metric whose list has no records yet. */
const NOTHING: MetricView = {
  id: 'm-nothing',
  name: 'Recruiter calls',
  period: 'week',
  target: 1,
  list: 'Recruiter calls',
  field: 'Called on',
  counts: counted('week', '2026-10-12T09:00:00Z', []),
};

/** A metric on the goal's closed steps, before any is counted (plan #2397.3). */
const STEPS_CLOSED: MetricView = {
  id: 'm-steps',
  name: 'Steps closed',
  period: 'week',
  target: 3,
  source: 'steps',
  list: null,
  field: null,
  counts: counted('week', '2026-10-12T09:00:00Z', []),
};

/** A metric on the files Dash writes under the goal, monthly with no aim. */
const DASH_FILES: MetricView = {
  id: 'm-files',
  name: 'Drafts and notes from Dash',
  period: 'month',
  target: null,
  source: 'files',
  list: null,
  field: null,
  counts: counted('month', '2026-10-01T09:00:00Z', []),
};

export function GoalMetricsSurface() {
  return <GoalMetrics metrics={[APPLICATIONS, INTERVIEWS, RUNS]} />;
}

/** Hovering or focusing a bar: the tooltip held on the week of 21 Sep, the busiest. */
export function GoalMetricsTooltipSurface() {
  return <GoalMetrics metrics={[APPLICATIONS]} held={8} />;
}

/** Nothing counted yet: a list with no records, and a steps and a files metric. */
export function GoalMetricsEmptySurface() {
  return <GoalMetrics metrics={[NOTHING, STEPS_CLOSED, DASH_FILES]} />;
}

/** The read failed: the section's own message. */
export function GoalMetricsErrorSurface() {
  return <GoalMetrics metrics={null} />;
}
