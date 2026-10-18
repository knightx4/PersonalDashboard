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
  {
    id: 'm-steps',
    goalId: GOAL_ID,
    name: 'Steps closed',
    source: 'steps',
    collectionId: null,
    dateField: null,
    period: 'week',
    target: 3,
    position: 2,
  },
  {
    id: 'm-files',
    goalId: GOAL_ID,
    name: 'Drafts and notes from Dash',
    source: 'files',
    collectionId: null,
    dateField: null,
    period: 'month',
    target: null,
    position: 3,
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

/** Four metrics: two on a list, one with the longest name, then closed steps and Dash files. */
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

/** A goal with no metrics and no list: what can be counted, and the add line. */
export function GoalMetricPropsEmptySurface() {
  return <Metrics metrics={[]} lists={[]} />;
}

/**
 * Adding one on a goal whose only list has no date: the choice starts on
 * Steps closed, and no date is asked for (plan #2397.3).
 */
export function GoalMetricPropsFormStepsSurface() {
  return <Metrics metrics={[]} lists={[LISTS[1]]} shown={{ open: 'add' }} />;
}

/** A new metric being saved: the button holds its pending state. */
export function GoalMetricPropsPendingSurface() {
  return <Metrics shown={{ open: 'add', pending: true }} />;
}

/**
 * A change to the steps metric refused: the message sits beside the aim it
 * is about, and no date is asked for (plan #2397.3).
 */
export function GoalMetricPropsErrorSurface() {
  return (
    <Metrics
      shown={{
        open: 'm-steps',
        target: '0',
        state: { field: 'target', error: 'The target is a whole number of at least 1.' },
      }}
    />
  );
}
