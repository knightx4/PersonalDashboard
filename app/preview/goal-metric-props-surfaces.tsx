import { cardVariants } from '@/components/ui/card';
import { Property, PropertyList } from '@/components/shell/detail-layout';
import type { MetricList } from '@/lib/goals/metric-form';
import type { Metric } from '@/lib/goals/metrics';
import { MetricsProperty, type MetricsShown } from '@/app/goals/[goalId]/metrics-property';
import { PressOnMount } from './press-on-mount';

/**
 * A goal's metrics in its properties column (plan #2084.3), drawn as the
 * column is: the full width of a phone, as the opened "All details" fold
 * shows it, and the 15rem rail from laptop width. The facts above the
 * metrics are there for scale.
 */

const GOAL_ID = '00000000-0000-4000-8000-0000000000a1';

const LISTS: MetricList[] = [
  {
    id: 'l-applications',
    name: 'Applications',
    dateFields: [
      { key: 'applied', label: 'Applied on' },
      { key: 'interview', label: 'Interview on' },
    ],
  },
  { id: 'l-contacts', name: 'People to ask about roles', dateFields: [] },
];

const METRICS: Metric[] = [
  {
    id: 'm-applied',
    goalId: GOAL_ID,
    name: 'Applications sent to funds and banks each week',
    source: 'list',
    collectionId: 'l-applications',
    dateField: 'applied',
    period: 'week',
    target: 5,
    position: 0,
  },
  {
    id: 'm-interviews',
    goalId: GOAL_ID,
    name: 'Interviews',
    source: 'list',
    collectionId: 'l-applications',
    dateField: 'interview',
    period: 'month',
    target: null,
    position: 1,
  },
];

function Column({ children }: { children: React.ReactNode }) {
  return (
    <aside
      aria-label="Properties"
      className={cardVariants({ padding: 'dense', className: 'lg:ml-auto lg:w-60' })}
    >
      <PropertyList>
        <Property label="Area" value="Career" />
        <Property label="Due" value="Q1 2027" />
        <Property label="Open steps" wide value="3 yours · 1 Dash’s" />
      </PropertyList>
      {children}
    </aside>
  );
}

function Metrics({
  metrics = METRICS,
  lists = LISTS,
  shown,
}: {
  metrics?: Metric[];
  lists?: MetricList[];
  shown?: MetricsShown;
}) {
  return (
    <Column>
      <MetricsProperty goalId={GOAL_ID} metrics={metrics} lists={lists} shown={shown} />
    </Column>
  );
}

/** Two metrics, one with the longest name, and the line that adds another. */
export function GoalMetricPropsSurface() {
  return <Metrics />;
}

/** The add line pressed: the form open in place, on the first list with a date. */
export function GoalMetricPropsFormSurface() {
  return <Metrics shown={{ open: 'add' }} />;
}

/** A row pointed at, its menu pressed open: Change and Remove. */
export function GoalMetricPropsMenuSurface() {
  return (
    <PressOnMount selector='button[aria-label="Interviews actions"]'>
      <Metrics shown={{ revealed: 'm-interviews' }} />
    </PressOnMount>
  );
}

/** A goal whose only list has no date: nothing to count, and it says so. */
export function GoalMetricPropsEmptySurface() {
  return <Metrics metrics={[]} lists={[LISTS[1]]} />;
}

/** A new metric being saved: the button holds its pending state. */
export function GoalMetricPropsPendingSurface() {
  return <Metrics shown={{ open: 'add', pending: true }} />;
}

/** A change refused: the message sits beside the date it is about. */
export function GoalMetricPropsErrorSurface() {
  return (
    <Metrics
      shown={{
        open: 'm-applied',
        state: { field: 'dateField', error: 'That date is no longer in Applications. Choose another.' },
      }}
    />
  );
}
